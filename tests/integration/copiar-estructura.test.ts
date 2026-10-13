// Copiar estructura de una gestión a otra, contra PostgreSQL real.
// El caso clave es la DOBLE PULSACIÓN: ConceptoPago no tiene restricción única,
// así que dos peticiones simultáneas podían duplicar los conceptos de pago.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { HAY_BD, limpiarBD, crearDirector, crearGestion, crearCurso, crearDocente, asignarMateria } from './helpers.js'

const { default: app } = await import('../../src/app.js')
const { prisma } = await import('../../src/lib/prisma.js')

describe.skipIf(!HAY_BD)('Copiar estructura (PostgreSQL real)', () => {
  let auth: Record<string, string>
  let g26: Awaited<ReturnType<typeof crearGestion>>
  let g27: Awaited<ReturnType<typeof crearGestion>>

  beforeAll(async () => { await limpiarBD() })
  beforeEach(async () => {
    await limpiarBD()
    auth = (await crearDirector()).auth
    const docente = await crearDocente()
    g26 = await crearGestion(2026, true, true)
    g27 = await crearGestion(2027, false, false)
    const c1 = await crearCurso(g26.gestion.id, 'SECUNDARIA', 1)
    await crearCurso(g26.gestion.id, 'SECUNDARIA', 2)
    await asignarMateria(c1, 'MAT', docente.id)
    await prisma.conceptoPago.createMany({ data: [
      { gestionId: g26.gestion.id, nombre: 'Matrícula', monto: 100 },
      { gestionId: g26.gestion.id, nombre: 'Mensualidad', monto: 50 },
    ] })
  })
  afterAll(async () => { await prisma.$disconnect() })

  const copiar = (body: unknown, destino = () => g27.gestion.id) =>
    request(app).post(`/api/gestiones/${destino()}/copiar-estructura`).set(auth).send(body as object)

  it('copia cursos, asignaciones, trimestres y conceptos', async () => {
    const r = await copiar({ origenId: g26.gestion.id })
    expect(r.status).toBe(200)
    expect(r.body.cursos.copiados).toBe(2)
    expect(r.body.asignaciones.copiados).toBe(1)
    expect(r.body.conceptosPago.copiados).toBe(2)
    expect(await prisma.curso.count({ where: { gestionId: g27.gestion.id } })).toBe(2)
    expect(await prisma.trimestre.count({ where: { gestionId: g27.gestion.id } })).toBeGreaterThan(0)
  })

  it('es idempotente: la segunda vez no duplica nada', async () => {
    await copiar({ origenId: g26.gestion.id })
    const r = await copiar({ origenId: g26.gestion.id })
    expect(r.status).toBe(200)
    expect(r.body.cursos).toMatchObject({ copiados: 0, yaExistian: 2 })
    expect(r.body.conceptosPago).toMatchObject({ copiados: 0, yaExistian: 2 })
    expect(await prisma.conceptoPago.count({ where: { gestionId: g27.gestion.id } })).toBe(2)
  })

  it('doble pulsación SIMULTÁNEA: sin errores 500 y sin conceptos duplicados', async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, () => copiar({ origenId: g26.gestion.id })))
    expect(rs.every(r => r.status < 500)).toBe(true)
    expect(await prisma.conceptoPago.count({ where: { gestionId: g27.gestion.id } })).toBe(2)
    expect(await prisma.curso.count({ where: { gestionId: g27.gestion.id } })).toBe(2)
  })

  it('doble pulsación copiando SOLO conceptos de pago (sin restricción única): no duplica', async () => {
    const soloConceptos = { origenId: g26.gestion.id, cursos: false, asignaciones: false, trimestres: false, dimensiones: false, conceptosPago: true }
    const rs = await Promise.all(Array.from({ length: 6 }, () => copiar(soloConceptos)))
    expect(rs.every(r => r.status < 500)).toBe(true)
    expect(await prisma.conceptoPago.count({ where: { gestionId: g27.gestion.id } })).toBe(2)
  })

  it('validación: origenId faltante o inválido → 400; destino anterior → 400; origen = destino → 400', async () => {
    expect((await copiar({})).status).toBe(400)
    expect((await copiar({ origenId: 'abc' })).status).toBe(400)
    expect((await copiar({ origenId: g27.gestion.id })).status).toBe(400)
    expect((await copiar({ origenId: g27.gestion.id }, () => g26.gestion.id)).status).toBe(400)
  })

  it('gestión de origen inexistente → 404', async () => {
    expect((await copiar({ origenId: 99999 })).status).toBe(404)
  })

  it('sin opciones elegidas → 400', async () => {
    const r = await copiar({ origenId: g26.gestion.id, cursos: false, asignaciones: false, trimestres: false, dimensiones: false, conceptosPago: false })
    expect(r.status).toBe(400)
  })
})
