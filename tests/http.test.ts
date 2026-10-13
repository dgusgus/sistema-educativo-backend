import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { validar, paramEntero } from '../src/middlewares/validate.middleware.js'
import { errorMiddleware, notFoundMiddleware } from '../src/middlewares/error.middleware.js'
import { ErrorDeUsuario, NoEncontrado, Prohibido } from '../src/lib/errores.js'

function crearApp() {
  const app = express()
  app.use(express.json())

  const router = express.Router()
  router.param('id', paramEntero)
  router.get('/items/:id', (req, res) => { res.json({ id: Number(req.params.id) }) })
  app.use(router)

  app.post('/notas', validar({ body: z.object({ nota: z.coerce.number().min(0).max(100) }) }),
    (req, res) => { res.json(req.body) })

  // Express 5: req.query es de solo lectura; validar() debe poder reemplazarlo
  app.get('/lista', validar({ query: z.object({ pagina: z.coerce.number().int().min(1).default(1) }) }),
    (req, res) => { res.json(req.query) })

  app.get('/throw/usuario', () => { throw new ErrorDeUsuario('Dato mal puesto', 400, { campo: 'x' }) })
  app.get('/throw/404',     () => { throw new NoEncontrado('Actividad') })
  app.get('/throw/403',     () => { throw new Prohibido() })
  // handler ASYNC que rechaza: Express 5 debe enviarlo al errorMiddleware sin asyncHandler ni try/catch
  app.get('/throw/async', async () => { throw new Error('secreto interno: SELECT * FROM Usuario') })
  app.get('/throw/p2002', () => { throw Object.assign(new Error('Unique constraint failed on ci'), { code: 'P2002' }) })
  app.get('/throw/p2025', () => { throw Object.assign(new Error('Record to update not found'), { code: 'P2025' }) })

  app.use(notFoundMiddleware)
  app.use(errorMiddleware)
  return app
}

describe('validación de entrada', () => {
  const app = crearApp()

  it(':id no numérico → 400 (antes llegaba NaN a Prisma → 500)', async () => {
    expect((await request(app).get('/items/abc')).status).toBe(400)
    expect((await request(app).get('/items/-1')).status).toBe(400)
    expect((await request(app).get('/items/99999999999')).status).toBe(400)
    const ok = await request(app).get('/items/42')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ id: 42 })
  })

  it('body inválido → 400 con detalles por campo', async () => {
    const r = await request(app).post('/notas').send({ nota: 500 })
    expect(r.status).toBe(400)
    expect(r.body.detalles[0].campo).toBe('nota')
  })

  it('body válido llega al controller ya convertido', async () => {
    const r = await request(app).post('/notas').send({ nota: '85.5', basura: 'x' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ nota: 85.5 })      // número, y sin el campo desconocido
  })

  it('query validada reemplaza req.query (Express 5)', async () => {
    expect((await request(app).get('/lista')).body).toEqual({ pagina: 1 })
    expect((await request(app).get('/lista?pagina=3')).body).toEqual({ pagina: 3 })
    expect((await request(app).get('/lista?pagina=0')).status).toBe(400)
  })
})

describe('manejo centralizado de errores', () => {
  const app = crearApp()

  it('ErrorDeUsuario → su status, su mensaje y sus datos extra', async () => {
    const r = await request(app).get('/throw/usuario')
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'Dato mal puesto', campo: 'x' })
  })

  it('NoEncontrado → 404, Prohibido → 403', async () => {
    const a = await request(app).get('/throw/404')
    expect(a.status).toBe(404)
    expect(a.body.error).toBe('Actividad no encontrado')
    expect((await request(app).get('/throw/403')).status).toBe(403)
  })

  it('un handler async que rechaza llega al middleware SIN try/catch y sin filtrar detalles', async () => {
    const r = await request(app).get('/throw/async')
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.body)).not.toContain('SELECT')
    expect(r.body.error).toBe('Error interno del servidor')
  })

  it('Prisma P2002 → 409 y P2025 → 404 (antes ambos eran 500)', async () => {
    expect((await request(app).get('/throw/p2002')).status).toBe(409)
    expect((await request(app).get('/throw/p2025')).status).toBe(404)
  })

  it('ruta inexistente → 404 en JSON (antes: HTML de Express)', async () => {
    const r = await request(app).get('/no/existe')
    expect(r.status).toBe(404)
    expect(r.headers['content-type']).toMatch(/json/)
  })

  it('JSON malformado → 400', async () => {
    const r = await request(app).post('/notas').set('Content-Type', 'application/json').send('{"nota": ')
    expect(r.status).toBe(400)
  })
})
