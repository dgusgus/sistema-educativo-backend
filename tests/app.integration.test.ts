// Prueba de integración del ARMADO de la aplicación (app.ts) con una base de datos
// simulada: verifica el orden de middlewares y rutas sin necesitar PostgreSQL.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const { llamadasUsuario, respuestas, rolesDelUsuario } = vi.hoisted(() => ({
  llamadasUsuario: vi.fn(),
  // Respuestas configurables por test: 'modelo.metodo' → función
  respuestas: {} as Record<string, (...args: unknown[]) => unknown>,
  rolesDelUsuario: { actual: ['DIRECTOR'] as string[] },
}))

vi.mock('../src/lib/prisma.js', () => {
  // Cualquier modelo.método devuelve una promesa de null, salvo usuario.findUnique (contado)
  const modelo = (nombre: string) => new Proxy({}, {
    get: (_t, metodo) => {
      if (nombre === 'usuario' && metodo === 'findUnique') {
        return async () => {
          llamadasUsuario()
          return { username: 'dir', roles: rolesDelUsuario.actual, activo: true, passwordHash: 'hash-falso' }
        }
      }
      const personalizada = respuestas[`${nombre}.${String(metodo)}`]
      if (personalizada) return async (...args: unknown[]) => personalizada(...args)
      return async () => (String(metodo) === 'findMany' ? [] : String(metodo) === 'count' ? 0 : null)
    },
  })
  const prisma = new Proxy({}, {
    get: (_t, nombre: string) => {
      if (nombre === '$queryRaw')    return async () => [{ '?column?': 1 }]
      if (nombre === '$transaction') return async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops)
      return modelo(nombre)
    },
  })
  return { prisma }
})

const { default: app } = await import('../src/app.js')
const { firmarToken } = await import('../src/lib/token.helper.js')

const token = firmarToken({ id: 1, roles: ['DIRECTOR'], username: 'dir', nombre: 'Dir', passwordHash: 'hash-falso' })
const auth = { Authorization: `Bearer ${token}` }

beforeEach(() => {
  llamadasUsuario.mockClear()
  for (const k of Object.keys(respuestas)) delete respuestas[k]
  rolesDelUsuario.actual = ['DIRECTOR']
})

describe('armado de app.ts', () => {
  it('/api/health y /api/ready son públicos', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200)
    expect((await request(app).get('/api/ready')).status).toBe(200)
  })

  it('cualquier ruta protegida sin token → 401', async () => {
    for (const ruta of ['/api/pagos/1', '/api/boletin/1/2', '/api/estudiantes', '/api/dimensiones', '/api/dashboard', '/api/horarios']) {
      expect((await request(app).get(ruta)).status, ruta).toBe(401)
    }
  })

  it('authMiddleware consulta la BD UNA sola vez por request (antes: 2-3 veces en /pagos, /boletin, /horarios...)', async () => {
    for (const ruta of ['/api/pagos/1', '/api/boletin/detalle/1', '/api/horarios', '/api/institucion', '/api/actividades']) {
      llamadasUsuario.mockClear()
      await request(app).get(ruta).set(auth)
      expect(llamadasUsuario, ruta).toHaveBeenCalledTimes(1)
    }
  })

  it('ruta inexistente con token → 404 JSON', async () => {
    const r = await request(app).get('/api/no-existe').set(auth)
    expect(r.status).toBe(404)
    expect(r.headers['content-type']).toMatch(/json/)
  })

  it(':id inválido → 400 en vez de 500', async () => {
    const r = await request(app).get('/api/estudiantes/abc').set(auth)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('ID inválido')
  })

  it('login con cuerpo vacío → 400 por validación del esquema', async () => {
    const r = await request(app).post('/api/auth/login').send({})
    expect(r.status).toBe(400)
    expect(r.body.detalles.length).toBeGreaterThan(0)
  })

  it('listado de estudiantes: query inválida → 400; limite > 200 rechazado', async () => {
    expect((await request(app).get('/api/estudiantes?pagina=0').set(auth)).status).toBe(400)
    expect((await request(app).get('/api/estudiantes?pagina=1&limite=5000').set(auth)).status).toBe(400)
    expect((await request(app).get('/api/estudiantes?estadoInscripcion=INVENTADO').set(auth)).status).toBe(400)
    expect((await request(app).get('/api/estudiantes?pagina=1&limite=10').set(auth)).status).toBe(200)
  })

  it('registrar notas: cuerpo inválido → 400 antes de tocar la base de datos', async () => {
    const r = await request(app).post('/api/actividades-evaluativas/5/notas').set(auth).send({ notas: [] })
    expect(r.status).toBe(400)
  })

  it('X-Request-Id se devuelve en la respuesta', async () => {
    const r = await request(app).get('/api/health')
    expect(r.headers['x-request-id']).toBeTruthy()
  })
})


describe('control de pertenencia del docente (antes: cualquier docente podía tocar lo ajeno)', () => {
  const comoDocente = (esDueno: boolean) => {
    rolesDelUsuario.actual = ['DOCENTE']
    respuestas['docente.findFirst'] = () => ({ id: 5 })
    // la asignación solo existe si el docente es el dueño
    respuestas['docenteMateriaCurso.findFirst'] = () => (esDueno ? { id: 77 } : null)
    respuestas['bitacoraClase.findUnique'] = () => ({ docenteMateriaCursoId: 77 })
    respuestas['bitacoraClase.update'] = () => ({ id: 9 })
    respuestas['bitacoraClase.delete'] = () => ({ id: 9 })
    respuestas['actividadEvaluativa.findUnique'] = () => ({ id: 9, docenteMateriaCursoId: 77, trimestreId: 1, trimestre: { cerrado: false } })
  }

  it('DELETE /api/actividades/:id de otro docente → 403', async () => {
    comoDocente(false)
    expect((await request(app).delete('/api/actividades/9').set(auth)).status).toBe(403)
  })
  it('PUT /api/actividades/:id de otro docente → 403', async () => {
    comoDocente(false)
    expect((await request(app).put('/api/actividades/9').set(auth).send({ tema: 'x' })).status).toBe(403)
  })
  it('DELETE /api/actividades-evaluativas/:id de otro docente → 403', async () => {
    comoDocente(false)
    expect((await request(app).delete('/api/actividades-evaluativas/9').set(auth)).status).toBe(403)
  })

  it('el docente DUEÑO sigue pudiendo (200)', async () => {
    comoDocente(true)
    expect((await request(app).delete('/api/actividades/9').set(auth)).status).toBe(200)
    expect((await request(app).put('/api/actividades/9').set(auth).send({ tema: 'x' })).status).toBe(200)
  })

  it('desactivar una actividad de un trimestre CERRADO → 403', async () => {
    comoDocente(true)
    respuestas['actividadEvaluativa.findUnique'] = () => ({ id: 9, docenteMateriaCursoId: 77, trimestreId: 1, trimestre: { cerrado: true } })
    expect((await request(app).delete('/api/actividades-evaluativas/9').set(auth)).status).toBe(403)
  })

  it('registrar notas con inscripciones de OTRO curso → 400 (contexto académico)', async () => {
    comoDocente(true)
    respuestas['actividadEvaluativa.findUnique'] = () => ({ id: 9, docenteMateriaCursoId: 77, trimestreId: 1, puntajeMaximo: 10, trimestre: { cerrado: false } })
    respuestas['docenteMateriaCurso.findUnique'] = () => ({ gestionId: 1, cursoId: 3 })
    respuestas['trimestre.findUnique'] = () => ({ gestionId: 1 })
    respuestas['inscripcion.findMany'] = () => [{ id: 100, gestionId: 1, cursoId: 99 }]   // curso distinto
    const r = await request(app).post('/api/actividades-evaluativas/9/notas').set(auth)
      .send({ notas: [{ inscripcionId: 100, nota: 8 }] })
    expect(r.status).toBe(400)
    expect(r.body.inscripcionesInvalidas).toEqual([100])
  })
})
