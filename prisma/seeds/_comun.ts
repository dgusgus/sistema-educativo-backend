// prisma/seeds/_comun.ts
//
// Piezas compartidas por los perfiles de semilla (vacio, estructura, promocion, volumen).
// ¿Para qué? Cada perfil solo describe SU escenario; las guardas de seguridad, la limpieza,
// las contraseñas y los creadores (gestión, cursos, docentes, notas...) viven aquí una vez.
//
// Convenciones (las mismas de seed.ts, para que se sienta igual):
//   · Todo es determinista: mismo perfil → mismos datos (sin Math.random).
//   · Fechas en UTC y ancladas a "hoy" (SEED_ANCLA=AAAA-MM-DD las fija).
//   · Contraseñas de demo: director/admin1234 · secretaria/sec1234 · docNN/doc1234 · est_vNNN/est1234.

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { sembrarCatalogo } from '../seed.catalogo.js'

// ─── Contexto que reciben los perfiles ───────────────────────────────────────
export interface Ctx {
  prisma: PrismaClient
  hash:   { admin: string; sec: string; doc: string; est: string }
  ANCLA:  Date
  ANIO:   number
  materias: Record<string, { id: number }>
  verificar: (condicion: boolean, mensaje: string) => void
}

export interface Perfil {
  descripcion: string
  sembrar: (ctx: Ctx) => Promise<void>
}

// ─── Fechas (UTC) ────────────────────────────────────────────────────────────
export const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d))
export const ultimoDia = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()

function parseAncla(v?: string): Date {
  if (v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
    if (!m) throw new Error(`SEED_ANCLA inválida ("${v}"): usa AAAA-MM-DD`)
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  }
  const h = new Date()
  return new Date(Date.UTC(h.getFullYear(), h.getMonth(), h.getDate()))
}

/** Mes relativo a la ancla: 0 = el mes de "hoy", -1 = el anterior, 1 = el siguiente. */
export function mesRel(ancla: Date, delta: number): { y: number; m: number } {
  const d = new Date(Date.UTC(ancla.getUTCFullYear(), ancla.getUTCMonth() + delta, 1))
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
}

// ─── Arranque: guardas, limpieza, hashes ─────────────────────────────────────
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres', 'host.docker.internal'])

export async function iniciar(limpiar: boolean): Promise<Ctx & { cerrar: () => Promise<void>; fallos: string[] }> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Estos perfiles son de PRUEBA y se niegan a correr con NODE_ENV=production.')
  }
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL (defínela en el archivo .env).')

  // Limpiar borra TODO: solo se permite sobre una base local, salvo SEED_FORZAR=si.
  if (limpiar) {
    let host = ''
    try { host = new URL(url).hostname } catch { /* URL rara: se trata como no local */ }
    if (!HOSTS_LOCALES.has(host) && process.env.SEED_FORZAR !== 'si') {
      throw new Error(`--limpiar vacía TODA la base y el servidor "${host || url}" no parece local. Si de verdad es de pruebas: SEED_FORZAR=si.`)
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  if (limpiar) {
    const tablas = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
    if (tablas.length) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tablas.map(t => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)
    }
    console.log('🧹 Base vaciada (tablas de datos; las migraciones se conservan)')
  } else if ((await prisma.persona.count()) > 0) {
    await prisma.$disconnect()
    throw new Error('La base ya tiene datos. Agrega --limpiar para vaciarla antes de sembrar (o usa `pnpm prisma migrate reset`).')
  }

  const [admin, sec, doc, est] = await Promise.all(['admin1234', 'sec1234', 'doc1234', 'est1234'].map(p => bcrypt.hash(p, 4)))
  const ANCLA = parseAncla(process.env.SEED_ANCLA)
  const materias = (await sembrarCatalogo(prisma)).materias
  const fallos: string[] = []

  return {
    prisma, hash: { admin, sec, doc, est }, ANCLA, ANIO: ANCLA.getUTCFullYear(), materias, fallos,
    verificar: (ok, msg) => { if (!ok) { fallos.push(msg); console.error(`  ✗ ${msg}`) } else console.log(`  ✓ ${msg}`) },
    cerrar: () => prisma.$disconnect(),
  }
}

// ─── Nombres deterministas ───────────────────────────────────────────────────
const NOMBRES = ['Diego', 'Camila', 'Santiago', 'Fernanda', 'Mateo', 'Paola', 'Andrés', 'Daniela', 'Gabriel', 'Natalia', 'Cristián', 'Alejandra', 'Rodrigo', 'Carla', 'Felipe', 'María', 'José', 'Rosa', 'Luis', 'Elena']
const APELLIDOS = ['Condori', 'Mamani', 'Quispe', 'Flores', 'Tarqui', 'Huanca', 'Choque', 'Apaza', 'Ticona', 'Cruz', 'Ramos', 'Vargas', 'Torres', 'Choquehuanca', 'Paco', 'Limachi']
export const nombreDe   = (i: number) => NOMBRES[i % NOMBRES.length]
export const apellidoDe = (i: number) => `${APELLIDOS[i % APELLIDOS.length]} ${APELLIDOS[(i * 5 + 3) % APELLIDOS.length]}`

// ─── Personal ────────────────────────────────────────────────────────────────
export async function crearDirector(ctx: Ctx) {
  const u = await ctx.prisma.usuario.create({ data: { username: 'director', passwordHash: ctx.hash.admin, roles: ['DIRECTOR'] } })
  const p = await ctx.prisma.persona.create({ data: { ci: 'D001', nombre: 'Roberto', apellido: 'Vargas Mamani' } })
  return ctx.prisma.director.create({ data: { personaId: p.id, usuarioId: u.id } })
}

export async function crearSecretaria(ctx: Ctx) {
  const u = await ctx.prisma.usuario.create({ data: { username: 'secretaria', passwordHash: ctx.hash.sec, roles: ['SECRETARIA'] } })
  const p = await ctx.prisma.persona.create({ data: { ci: 'S001', nombre: 'Marta', apellido: 'Rojas Ticona' } })
  return ctx.prisma.secretaria.create({ data: { personaId: p.id, usuarioId: u.id } })
}

/** n docentes con cuenta: doc01..docNN / doc1234. */
export async function crearDocentes(ctx: Ctx, n: number) {
  const docentes = []
  for (let i = 1; i <= n; i++) {
    const u = await ctx.prisma.usuario.create({ data: { username: `doc${String(i).padStart(2, '0')}`, passwordHash: ctx.hash.doc, roles: ['DOCENTE'] } })
    const p = await ctx.prisma.persona.create({ data: { ci: `P${String(i).padStart(3, '0')}`, nombre: nombreDe(i + 4), apellido: apellidoDe(i + 40) } })
    docentes.push(await ctx.prisma.docente.create({ data: { personaId: p.id, usuarioId: u.id } }))
  }
  return docentes
}

// ─── Gestión, estructura ─────────────────────────────────────────────────────
type Mes = { y: number; m: number }

/** Gestión con 3 trimestres mensuales (uno por mes indicado). */
export async function crearGestion(ctx: Ctx, o: {
  anio: number; activa: boolean; descripcion: string; meses: [Mes, Mes, Mes]
  cerrados: [boolean, boolean, boolean]; directorId?: number
}) {
  const [a, , c] = o.meses
  const gestion = await ctx.prisma.gestion.create({
    data: {
      anio: o.anio, activa: o.activa, descripcion: o.descripcion, notaMinimaAprobacion: 51, directorId: o.directorId,
      fechaInicio: utc(a.y, a.m, 1), fechaFin: utc(c.y, c.m, ultimoDia(c.y, c.m)),
    },
  })
  const nombres = ['Primer Trimestre', 'Segundo Trimestre', 'Tercer Trimestre']
  const trimestres = []
  for (let i = 0; i < 3; i++) {
    const { y, m } = o.meses[i]
    trimestres.push(await ctx.prisma.trimestre.create({
      data: { gestionId: gestion.id, numero: i + 1, nombre: nombres[i], fechaInicio: utc(y, m, 1), fechaFin: utc(y, m, ultimoDia(y, m)), cerrado: o.cerrados[i] },
    }))
  }
  return { gestion, trimestres }
}

export async function crearDimensiones(ctx: Ctx, gestionId: number) {
  await ctx.prisma.dimensionEvaluacion.createMany({ data: [
    { gestionId, nombre: 'Ser',     puntajeMaximo: 5,  pesoEnPromedio: 0.05, orden: 1, esAutoevaluada: true },
    { gestionId, nombre: 'Saber',   puntajeMaximo: 45, pesoEnPromedio: 0.45, orden: 2 },
    { gestionId, nombre: 'Hacer',   puntajeMaximo: 40, pesoEnPromedio: 0.40, orden: 3 },
    { gestionId, nombre: 'Decidir', puntajeMaximo: 10, pesoEnPromedio: 0.10, orden: 4 },
  ] })
}

export async function crearConceptosPago(ctx: Ctx, gestionId: number) {
  await ctx.prisma.conceptoPago.createMany({ data: [
    { gestionId, nombre: 'Matrícula',    descripcion: 'Inscripción anual', monto: 100, obligatorio: true },
    { gestionId, nombre: 'Mensualidad',  descripcion: 'Aporte mensual',    monto: 50,  obligatorio: true },
    { gestionId, nombre: 'Material',     descripcion: 'Material didáctico', monto: 30, obligatorio: false },
  ] })
}

export type CursoCreado = { id: number; grado: number; paralelo: string; gestionId: number }

export async function crearCursos(ctx: Ctx, gestionId: number, grados: number[], paralelos: string[]): Promise<CursoCreado[]> {
  const data = grados.flatMap(grado => paralelos.map(paralelo => ({ gestionId, nivel: 'SECUNDARIA' as const, grado, paralelo, capacidad: 40 })))
  const filas = await ctx.prisma.curso.createManyAndReturn({ data })
  return filas.map(c => ({ id: c.id, grado: c.grado, paralelo: c.paralelo, gestionId: c.gestionId }))
}

/** Materias que se dictan en cada curso (QUE queda libre a propósito, como en seed.ts). */
export const MATERIAS_DICTADAS = ['MAT', 'LEN', 'CNA', 'CSO', 'ING', 'EFI', 'ART', 'TEC'] as const

/** Un docente por materia (reparto rotativo). Devuelve las asignaciones indexadas por curso y materia. */
export async function asignarMaterias(ctx: Ctx, gestionId: number, cursos: CursoCreado[], docentes: { id: number }[]) {
  const data = cursos.flatMap(c => MATERIAS_DICTADAS.map((cod, i) => ({
    gestionId, cursoId: c.id, materiaId: ctx.materias[cod].id, docenteId: docentes[i % docentes.length].id,
  })))
  const filas = await ctx.prisma.docenteMateriaCurso.createManyAndReturn({ data })
  const idMateria = new Map(MATERIAS_DICTADAS.map(cod => [ctx.materias[cod].id, cod]))
  const porCurso = new Map<number, { id: number; codigo: string }[]>()
  for (const f of filas) {
    const lista = porCurso.get(f.cursoId) ?? []
    lista.push({ id: f.id, codigo: idMateria.get(f.materiaId)! })
    porCurso.set(f.cursoId, lista)
  }
  for (const l of porCurso.values()) l.sort((a, b) => MATERIAS_DICTADAS.indexOf(a.codigo as never) - MATERIAS_DICTADAS.indexOf(b.codigo as never))
  return porCurso
}

// ─── Estudiantes ─────────────────────────────────────────────────────────────
/** Crea n estudiantes en bloque (rápido incluso con cientos). Las primeras `conCuenta` tienen usuario est_vNNN. */
export async function crearEstudiantes(ctx: Ctx, n: number, o: { desde?: number; prefijoCi?: string; conCuenta?: number } = {}) {
  const desde = o.desde ?? 1
  const prefijo = o.prefijoCi ?? 'V'
  const idx = Array.from({ length: n }, (_, k) => desde + k)
  const ci = (i: number) => `${prefijo}${String(i).padStart(5, '0')}`

  const personas = await ctx.prisma.persona.createManyAndReturn({
    data: idx.map(i => ({ ci: ci(i), nombre: nombreDe(i), apellido: apellidoDe(i) })),
  })
  const idPorCi = new Map(personas.map(p => [p.ci!, p.id]))
  const estudiantes = await ctx.prisma.estudiante.createManyAndReturn({
    data: idx.map(i => ({ personaId: idPorCi.get(ci(i))! })),
  })
  const porPersona = new Map(estudiantes.map(e => [e.personaId, e]))
  const lista = idx.map(i => ({ i, ci: ci(i), estudianteId: porPersona.get(idPorCi.get(ci(i))!)!.id }))

  for (const e of lista.slice(0, o.conCuenta ?? 0)) {
    const u = await ctx.prisma.usuario.create({ data: { username: `est_v${String(e.i).padStart(3, '0')}`, passwordHash: ctx.hash.est, roles: ['ESTUDIANTE'] } })
    await ctx.prisma.estudiante.update({ where: { id: e.estudianteId }, data: { usuarioId: u.id } })
  }
  return lista
}

// ─── Notas ───────────────────────────────────────────────────────────────────
/** Situación académica de un estudiante en el año (determina sus notas). */
export type PerfilNotas =
  | 'ALTO'          // promedios 80-95
  | 'MEDIO'         // promedios 60-78
  | 'REPRUEBA_MAT'  // Matemáticas ~40, el resto aprobado → REPROBADO
  | 'INCOMPLETO'    // falta la nota del T3 en la última materia → "sin resultado" en Promoción
  | 'RETIRADO'      // solo tiene T1

const notaBase = (perfil: PerfilNotas, i: number, materia: number, trim: number): number => {
  const ruido = (i * 7 + materia * 3 + trim * 5) % 12
  if (perfil === 'ALTO')  return 80 + ruido
  if (perfil === 'REPRUEBA_MAT' && materia === 0) return 38 + (ruido % 8)
  return 60 + ruido
}

export interface InscripcionNotas {
  inscripcionId: number
  idx: number
  perfil: PerfilNotas
  asignaciones: { id: number }[]   // las del curso, en el orden de MATERIAS_DICTADAS
}

/**
 * Escribe Calificacion (y PromedioFinal si la gestión tiene los 3 trimestres con nota)
 * para todas las inscripciones, en bloques de 1000.
 * Devuelve, por inscripción, si aprueba todo (true), reprueba algo (false) o no se puede decir (null).
 */
export async function ponerNotas(
  ctx: Ctx, trimestres: { id: number }[], filas: InscripcionNotas[], notaMinima = 51,
): Promise<Map<number, boolean | null>> {
  const califs: { inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; promedioTrimestral: number }[] = []
  const finales: { inscripcionId: number; docenteMateriaCursoId: number; promedioFinal: number; resultado: 'PROMOVIDO' | 'REPROBADO' }[] = []
  const aprueba = new Map<number, boolean | null>()

  for (const f of filas) {
    let todoAprobado = true
    let completo = f.perfil !== 'RETIRADO'
    f.asignaciones.forEach((a, m) => {
      const notas: number[] = []
      for (let t = 0; t < trimestres.length; t++) {
        if (f.perfil === 'RETIRADO' && t > 0) continue
        if (f.perfil === 'INCOMPLETO' && t === 2 && m === f.asignaciones.length - 1) { completo = false; continue }
        const nota = notaBase(f.perfil, f.idx, m, t)
        notas.push(nota)
        califs.push({ inscripcionId: f.inscripcionId, docenteMateriaCursoId: a.id, trimestreId: trimestres[t].id, promedioTrimestral: nota })
      }
      if (notas.length === trimestres.length) {
        const prom = Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 100) / 100
        if (prom < notaMinima) todoAprobado = false
        finales.push({ inscripcionId: f.inscripcionId, docenteMateriaCursoId: a.id, promedioFinal: prom, resultado: prom >= notaMinima ? 'PROMOVIDO' : 'REPROBADO' })
      }
    })
    aprueba.set(f.inscripcionId, completo ? todoAprobado : null)
  }

  for (let i = 0; i < califs.length; i += 1000) await ctx.prisma.calificacion.createMany({ data: califs.slice(i, i + 1000) })
  for (let i = 0; i < finales.length; i += 1000) await ctx.prisma.promedioFinal.createMany({ data: finales.slice(i, i + 1000) })
  return aprueba
}

// ─── Resumen ─────────────────────────────────────────────────────────────────
export function mostrarCredenciales(lineas: string[]) {
  console.log('\nCREDENCIALES (solo desarrollo):')
  for (const l of lineas) console.log(`  ${l}`)
}
