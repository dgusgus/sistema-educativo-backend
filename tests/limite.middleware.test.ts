import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { limitePorUsuario } from '../src/middlewares/limite.middleware.js'

// Mini app: el "usuario" viene del header x-uid (en la real lo pone authMiddleware).
function app() {
  const a = express()
  a.use((req, _res, next) => { (req as unknown as { user: { id: number } }).user = { id: Number(req.header('x-uid')) }; next() })
  a.post('/x', limitePorUsuario({ max: 2, ventanaMin: 1, activoEnTest: true }), (_req, res) => { res.json({ ok: true }) })
  return a
}

describe('limitePorUsuario', () => {
  it('corta al pasar el cupo con 429 y mensaje en JSON', async () => {
    const a = app()
    expect((await request(a).post('/x').set('x-uid', '1')).status).toBe(200)
    expect((await request(a).post('/x').set('x-uid', '1')).status).toBe(200)
    const r = await request(a).post('/x').set('x-uid', '1')
    expect(r.status).toBe(429)
    expect(r.body.error).toMatch(/Demasiadas/)
  })

  it('el cupo es por usuario: otro usuario (misma IP) no se ve afectado', async () => {
    const a = app()
    for (let i = 0; i < 3; i++) await request(a).post('/x').set('x-uid', '1')
    expect((await request(a).post('/x').set('x-uid', '2')).status).toBe(200)
  })
})
