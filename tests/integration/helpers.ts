// Utilidades para los tests de integración contra PostgreSQL REAL.
import { prisma } from '../../src/lib/prisma.js'
import { firmarToken } from '../../src/lib/token.helper.js'

export const HAY_BD = !!process.env.TEST_DATABASE_URL

// Vacía TODAS las tablas (menos _prisma_migrations) y reinicia los ids.
export async function limpiarBD() {
  const tablas = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  if (tablas.length === 0) return
  const lista = tablas.map(t => `"${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`)
}

export async function crearDirector() {
  const usuario = await prisma.usuario.create({
    data: { username: 'director', passwordHash: 'hash-de-prueba', roles: ['DIRECTOR'] },
  })
  const token = firmarToken({
    id: usuario.id, roles: usuario.roles, username: usuario.username, nombre: 'Director', passwordHash: usuario.passwordHash,
  })
  return { usuario, auth: { Authorization: `Bearer ${token}` } }
}

let contadorCi = 1000
export async function crearEstudiante(nombre: string, apellido: string) {
  const persona = await prisma.persona.create({ data: { nombre, apellido, ci: String(contadorCi++) } })
  return prisma.estudiante.create({ data: { personaId: persona.id } })
}

type Nivel = 'PRIMARIA' | 'SECUNDARIA'

export async function crearGestion(anio: number, activa: boolean, cerrarTrimestres: boolean) {
  const gestion = await prisma.gestion.create({ data: { anio, activa, notaMinimaAprobacion: 51 } })
  const trimestres = []
  for (const numero of [1, 2, 3]) {
    trimestres.push(await prisma.trimestre.create({
      data: {
        gestionId: gestion.id, numero, nombre: `Trimestre ${numero}`, cerrado: cerrarTrimestres,
        fechaInicio: new Date(`${anio}-0${numero * 3 - 2}-01`), fechaFin: new Date(`${anio}-0${numero * 3 - 1}-28`),
      },
    }))
  }
  return { gestion, trimestres }
}

export async function crearCurso(gestionId: number, nivel: Nivel, grado: number, paralelo = 'A') {
  return prisma.curso.create({ data: { gestionId, nivel, grado, paralelo } })
}

// Una materia (reutiliza si ya existe por código) asignada a un curso, con su docente.
export async function asignarMateria(curso: { id: number; gestionId: number }, codigo: string, docenteId: number) {
  const materia = await prisma.materia.upsert({
    where: { codigo }, update: {}, create: { codigo, nombre: `Materia ${codigo}` },
  })
  return prisma.docenteMateriaCurso.create({
    data: { docenteId, materiaId: materia.id, cursoId: curso.id, gestionId: curso.gestionId },
  })
}

export async function crearDocente() {
  const persona = await prisma.persona.create({ data: { nombre: 'Docente', apellido: 'Prueba', ci: String(contadorCi++) } })
  return prisma.docente.create({ data: { personaId: persona.id } })
}

export async function inscribir(estudianteId: number, curso: { id: number; gestionId: number }, extra: Record<string, unknown> = {}) {
  return prisma.inscripcion.create({ data: { estudianteId, cursoId: curso.id, gestionId: curso.gestionId, ...extra } })
}

// Notas: una nota igual en los 3 trimestres para la materia indicada.
export async function ponerNotas(
  inscripcionId: number, dmcId: number, trimestres: { id: number }[], nota: number,
) {
  for (const t of trimestres) {
    await prisma.calificacion.create({
      data: { inscripcionId, docenteMateriaCursoId: dmcId, trimestreId: t.id, promedioTrimestral: nota },
    })
  }
}
