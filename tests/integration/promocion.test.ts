// Flujo COMPLETO de promoción contra PostgreSQL real, a través de HTTP:
//   Paso 1: registrar resultados  →  Paso 2: matricular en la gestión siguiente.
// Estos tests describen el comportamiento ACTUAL (antes de refactorizar) y se
// mantienen idénticos después: si el refactor cambia algo, fallan.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { HAY_BD, limpiarBD, crearDirector, crearEstudiante, crearGestion, crearCurso, crearDocente, asignarMateria, inscribir, ponerNotas } from './helpers.js'

const { default: app } = await import('../../src/app.js')
const { prisma } = await import('../../src/lib/prisma.js')

type Ctx = Awaited<ReturnType<typeof montarEscenario>>

// Escenario: gestión 2026 (trimestres cerrados) con 1° Sec "A" y 6° Sec "A"; gestión 2027 con 1° y 2° Sec "A".
async function montarEscenario() {
  const { auth } = await crearDirector()
  const docente = await crearDocente()

  const g26 = await crearGestion(2026, true, true)
  const g27 = await crearGestion(2027, false, false)

  const c1_26 = await crearCurso(g26.gestion.id, 'SECUNDARIA', 1)
  const c6_26 = await crearCurso(g26.gestion.id, 'SECUNDARIA', 6)
  const c1_27 = await crearCurso(g27.gestion.id, 'SECUNDARIA', 1)
  const c2_27 = await crearCurso(g27.gestion.id, 'SECUNDARIA', 2)

  const mat1 = await asignarMateria(c1_26, 'MAT', docente.id)
  const len1 = await asignarMateria(c1_26, 'LEN', docente.id)
  const mat6 = await asignarMateria(c6_26, 'MAT', docente.id)

  const ana   = await crearEstudiante('Ana', 'Aliaga')     // aprueba todo
  const beto  = await crearEstudiante('Beto', 'Barrios')   // reprueba Lenguaje
  const carla = await crearEstudiante('Carla', 'Choque')   // sin notas (incompleta)
  const dani  = await crearEstudiante('Dani', 'Duran')     // 6° aprueba → egresa
  const eva   = await crearEstudiante('Eva', 'Espinoza')   // retirada

  const iAna   = await inscribir(ana.id,   c1_26)
  const iBeto  = await inscribir(beto.id,  c1_26)
  const iCarla = await inscribir(carla.id, c1_26)
  const iDani  = await inscribir(dani.id,  c6_26)
  const iEva   = await inscribir(eva.id,   c1_26, { estadoInscripcion: 'RETIRADA' })

  await ponerNotas(iAna.id,  mat1.id, g26.trimestres, 80); await ponerNotas(iAna.id,  len1.id, g26.trimestres, 75)
  await ponerNotas(iBeto.id, mat1.id, g26.trimestres, 70); await ponerNotas(iBeto.id, len1.id, g26.trimestres, 30)
  await ponerNotas(iDani.id, mat6.id, g26.trimestres, 90)

  return { auth, g26, g27, c1_26, c6_26, c1_27, c2_27, iAna, iBeto, iCarla, iDani, iEva }
}

describe.skipIf(!HAY_BD)('Promoción de gestión (PostgreSQL real)', () => {
  let ctx: Ctx
  beforeAll(async () => { await limpiarBD() })
  beforeEach(async () => { await limpiarBD(); ctx = await montarEscenario() })
  afterAll(async () => { await prisma.$disconnect() })

  const get  = (url: string) => request(app).get(url).set(ctx.auth)
  const post = (url: string, body: unknown) => request(app).post(url).set(ctx.auth).send(body as object)

  describe('Tablero de cursos', () => {
    it('cuenta estudiantes, sin resultado y estado por curso', async () => {
      const r = await get(`/api/gestiones/${ctx.g26.gestion.id}/promocion/cursos?destinoId=${ctx.g27.gestion.id}`)
      expect(r.status).toBe(200)
      const c1 = r.body.cursos.find((c: { cursoId: number }) => c.cursoId === ctx.c1_26.id)
      expect(c1).toMatchObject({ estudiantes: 3, sinResultado: 3, estado: 'RESULTADOS_PENDIENTES' })   // la retirada no cuenta
    })

    it('destino anterior al origen → 400', async () => {
      const r = await get(`/api/gestiones/${ctx.g27.gestion.id}/promocion/cursos?destinoId=${ctx.g26.gestion.id}`)
      expect(r.status).toBe(400)
    })
  })

  describe('Paso 1 · resultados', () => {
    it('propuesta: Ana PROMOVIDO, Beto REPROBADO (Lenguaje), Carla INCOMPLETO', async () => {
      const r = await get(`/api/gestiones/${ctx.g26.gestion.id}/propuesta-resultados?cursoId=${ctx.c1_26.id}`)
      expect(r.status).toBe(200)
      const por = (id: number) => r.body.resultados.find((x: { inscripcionId: number }) => x.inscripcionId === id)
      expect(por(ctx.iAna.id)).toMatchObject({ estado: 'LISTO', sugerido: 'PROMOVIDO' })
      expect(por(ctx.iBeto.id)).toMatchObject({ estado: 'LISTO', sugerido: 'REPROBADO' })
      expect(por(ctx.iBeto.id).materiasReprobadas[0]).toMatchObject({ materia: 'Materia LEN', promedio: 30 })
      expect(por(ctx.iCarla.id)).toMatchObject({ estado: 'INCOMPLETO', sugerido: null })
    })

    it('trimestre abierto → 400 (no se puede calcular)', async () => {
      const r = await get(`/api/gestiones/${ctx.g27.gestion.id}/propuesta-resultados`)
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/trimestres sin cerrar/)
    })

    it('registrar: escribe PROMOVIDO/REPROBADO y rechaza a la incompleta sin frenar al resto', async () => {
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/resultados`, {
        inscripcionIds: [ctx.iAna.id, ctx.iBeto.id, ctx.iCarla.id], cursoId: ctx.c1_26.id,
      })
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ solicitados: 3, actualizados: 2, promovidos: 1, reprobados: 1, sinCambios: 0 })
      expect(r.body.errores).toHaveLength(1)
      expect(r.body.errores[0].inscripcionId).toBe(ctx.iCarla.id)

      const ana = await prisma.inscripcion.findUniqueOrThrow({ where: { id: ctx.iAna.id } })
      const beto = await prisma.inscripcion.findUniqueOrThrow({ where: { id: ctx.iBeto.id } })
      expect([ana.resultado, beto.resultado]).toEqual(['PROMOVIDO', 'REPROBADO'])
    })

    it('registrar dos veces → la segunda marca sinCambios (idempotente)', async () => {
      const body = { inscripcionIds: [ctx.iAna.id, ctx.iBeto.id], cursoId: ctx.c1_26.id }
      await post(`/api/gestiones/${ctx.g26.gestion.id}/resultados`, body)
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/resultados`, body)
      expect(r.body).toMatchObject({ actualizados: 0, sinCambios: 2 })
    })

    it('un estudiante de OTRO curso con cursoId indicado → error por fila', async () => {
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/resultados`, { inscripcionIds: [ctx.iDani.id], cursoId: ctx.c1_26.id })
      expect(r.status).toBe(200)
      expect(r.body.errores).toHaveLength(1)
    })
  })

  describe('Paso 2 · matrícula', () => {
    const registrarResultados = async () => {
      await post(`/api/gestiones/${ctx.g26.gestion.id}/resultados`, { inscripcionIds: [ctx.iAna.id, ctx.iBeto.id], cursoId: ctx.c1_26.id })
      await post(`/api/gestiones/${ctx.g26.gestion.id}/resultados`, { inscripcionIds: [ctx.iDani.id], cursoId: ctx.c6_26.id })
    }

    it('propuesta: grupos, cursos de destino y sugeridos', async () => {
      await registrarResultados()
      const r = await get(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricula?cursoId=${ctx.c1_26.id}&destinoId=${ctx.g27.gestion.id}`)
      expect(r.status).toBe(200)
      expect(r.body.resumen).toMatchObject({ promovidos: 1, repiten: 1, sinResultado: 1, noAplica: 1, porMatricular: 2 })
      expect(r.body.sugeridoPromovidosId).toBe(ctx.c2_27.id)
      expect(r.body.sugeridoRepitenId).toBe(ctx.c1_27.id)
    })

    it('matricular: promovido → 2°, repetidor → 1°, y crea las inscripciones', async () => {
      await registrarResultados()
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, {
        destinoId: ctx.g27.gestion.id, cursoOrigenId: ctx.c1_26.id,
        cursoPromovidosId: ctx.c2_27.id, cursoRepitenId: ctx.c1_27.id,
        inscripcionIds: [ctx.iAna.id, ctx.iBeto.id],
      })
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ solicitados: 2, matriculados: 2, promovidos: 1, repiten: 1, errores: [] })

      const nuevas = await prisma.inscripcion.findMany({ where: { gestionId: ctx.g27.gestion.id }, orderBy: { estudianteId: 'asc' } })
      expect(nuevas.map(i => i.cursoId)).toEqual([ctx.c2_27.id, ctx.c1_27.id])
      expect(nuevas.every(i => i.estadoInscripcion === 'ACTIVA' && i.resultado === 'PENDIENTE')).toBe(true)
    })

    it('matricular dos veces lo mismo → la segunda reporta "Ya está inscrito" y no duplica', async () => {
      await registrarResultados()
      const pedido = {
        destinoId: ctx.g27.gestion.id, cursoOrigenId: ctx.c1_26.id,
        cursoPromovidosId: ctx.c2_27.id, cursoRepitenId: ctx.c1_27.id, inscripcionIds: [ctx.iAna.id, ctx.iBeto.id],
      }
      await post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, pedido)
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, pedido)
      expect(r.status).toBe(200)
      expect(r.body.matriculados).toBe(0)
      expect(r.body.errores).toHaveLength(2)
      expect(await prisma.inscripcion.count({ where: { gestionId: ctx.g27.gestion.id } })).toBe(2)
    })

    it('DOBLE CLIC SIMULTÁNEO: no duplica y ninguna petición termina en 500', async () => {
      await registrarResultados()
      const pedido = {
        destinoId: ctx.g27.gestion.id, cursoOrigenId: ctx.c1_26.id,
        cursoPromovidosId: ctx.c2_27.id, cursoRepitenId: ctx.c1_27.id, inscripcionIds: [ctx.iAna.id, ctx.iBeto.id],
      }
      const [a, b] = await Promise.all([
        post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, pedido),
        post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, pedido),
      ])
      expect([a.status, b.status].every(s => s < 500)).toBe(true)
      expect(await prisma.inscripcion.count({ where: { gestionId: ctx.g27.gestion.id } })).toBe(2)
    })

    it('el curso de promovidos de otro grado → 400', async () => {
      await registrarResultados()
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, {
        destinoId: ctx.g27.gestion.id, cursoOrigenId: ctx.c1_26.id,
        cursoPromovidosId: ctx.c1_27.id,   // debería ser 2°
        inscripcionIds: [ctx.iAna.id],
      })
      expect(r.status).toBe(400)
    })

    it('sin resultado → error por fila, no matricula', async () => {
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, {
        destinoId: ctx.g27.gestion.id, cursoOrigenId: ctx.c1_26.id, cursoPromovidosId: ctx.c2_27.id, inscripcionIds: [ctx.iCarla.id],
      })
      expect(r.status).toBe(200)
      expect(r.body.matriculados).toBe(0)
      expect(r.body.errores[0].error).toMatch(/resultado final/)
    })

    it('6° Secundaria promovido egresa: no se matricula', async () => {
      await registrarResultados()
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, {
        destinoId: ctx.g27.gestion.id, cursoOrigenId: ctx.c6_26.id, inscripcionIds: [ctx.iDani.id],
      })
      expect(r.body.matriculados).toBe(0)
      expect(r.body.errores[0].error).toMatch(/Egresa/)
    })

    it('si la gestión de origen YA se cerró (inscripciones CONCLUIDA) igual se puede matricular', async () => {
      await registrarResultados()
      await prisma.inscripcion.updateMany({ where: { gestionId: ctx.g26.gestion.id, estadoInscripcion: 'ACTIVA' }, data: { estadoInscripcion: 'CONCLUIDA' } })
      const r = await post(`/api/gestiones/${ctx.g26.gestion.id}/promocion/matricular`, {
        destinoId: ctx.g27.gestion.id, cursoOrigenId: ctx.c1_26.id,
        cursoPromovidosId: ctx.c2_27.id, cursoRepitenId: ctx.c1_27.id, inscripcionIds: [ctx.iAna.id, ctx.iBeto.id],
      })
      expect(r.body).toMatchObject({ matriculados: 2, errores: [] })
    })
  })

  describe('Validación en la ruta', () => {
    it('query inválida → 400 con mensaje legible; id numérico como texto se acepta', async () => {
      const g = ctx.g26.gestion.id
      const mala = await get(`/api/gestiones/${g}/promocion/matricula?cursoId=abc&destinoId=${ctx.g27.gestion.id}`)
      expect(mala.status).toBe(400)
      expect(mala.body.error).toMatch(/cursoId/)
      const falta = await get(`/api/gestiones/${g}/promocion/matricula?destinoId=${ctx.g27.gestion.id}`)
      expect(falta.status).toBe(400)
      expect(falta.body.error).toMatch(/cursoId: es obligatorio/)
      const ok = await get(`/api/gestiones/${g}/promocion/matricula?cursoId=${ctx.c1_26.id}&destinoId=${ctx.g27.gestion.id}`)
      expect(ok.status).toBe(200)
    })

    it('body inválido → 400 sin tocar la base', async () => {
      const g = ctx.g26.gestion.id
      expect((await post(`/api/gestiones/${g}/resultados`, { inscripcionIds: [] })).status).toBe(400)
      expect((await post(`/api/gestiones/${g}/resultados`, { inscripcionIds: [1, -3] })).status).toBe(400)
      expect((await post(`/api/gestiones/${g}/promocion/matricular`, { destinoId: ctx.g27.gestion.id })).status).toBe(400)
      expect(await prisma.inscripcion.count({ where: { gestionId: ctx.g27.gestion.id } })).toBe(0)
    })
  })
})
