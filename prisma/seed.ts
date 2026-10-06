// prisma/seed.ts
// Semilla de DEMO / desarrollo — colegio completo ficticio (schema v6):
//
//   12 cursos (1°-6° x A/B, SECUNDARIA) x 6 estudiantes = 72 activos
//   + Miguel (RETIRADO, caso de prueba heredado) = 73 inscripciones
//   ~66 tutores (mayoría 1:1, 6 compartidos + tutora multi-rol)
//   11 docentes (9 enseñando + 1 libre + 1 tutora-docente sin carga)
//   9 materias en 4 campos de saber (8 asignadas + QUECHUA libre → alerta dashboard)
//   Horarios completos y sin choques en 4 cursos (1°A, 1°B, 2°A, 2°B)
//   Trimestres MENSUALES anclados a "hoy": T1 y T2 cerrados, T3 = el mes en curso
//   (abierto, ~85% calificado → pendientes con nombres + cierre manual como prueba).
//   Gestión siguiente creada INACTIVA y vacía para probar promoción / activación.
//
// PERFILES DE SEED (situaciones de prueba — se combinan por ejecución,
// sin flags = DEFENSA, el dataset de siempre):
//   (default)                   T3 al ~85% → pendientes con nombres + cierre que rechaza
//   SEED_T3_COMPLETO=si         T3 al 100% → cerrar desde el sistema completa el año
//   SEED_ANCLA=2025-08-31       reproduce el dataset fijo anterior
//   SEED_PASSWORD_DEMO=<clave>  demo público (todas las cuentas con esa clave)
// REGLAS: el default nunca cambia; un flag = una variación documentada aquí y en
// .env.example; la VERIFICACIÓN espera lo de cada perfil (si falla, sale con código 1).
// Candidatos futuros (solo cuando haya caso real): SEED_SIN_PAGOS, SEED_CURSO_VACIO,
// SEED_GESTION_CERRADA.
//
// FECHAS: todo se calcula respecto a una ANCLA (por defecto, la fecha de HOY), así el
// dashboard se ve "vivo" (el trimestre abierto incluye hoy, nada aparece como vencido).
// Para reproducir EXACTAMENTE el dataset fijo de siempre (gestión 2025):
//     SEED_ANCLA=2025-08-31 pnpm db:seed
// Las fechas se arman en UTC: el resultado es el mismo en cualquier zona horaria
// (antes, en una máquina al este de UTC toda la asistencia se corría un día atrás).
//
// SEGURIDAD:
//   • Se NIEGA a correr con NODE_ENV=production (salvo SEED_PERMITIR_PRODUCCION=si,
//     p. ej. un demo público: en ese caso use SEED_PASSWORD_DEMO para no dejar las
//     contraseñas por defecto).
//   • Se NIEGA a mezclarse con una base que ya tiene datos reales (SEED_FORZAR=si lo omite)
//     o con datos de otra gestión: use `pnpm prisma migrate reset`.
//   • Si algo falla, sale con código 1 (antes salía con 0 y parecía exitoso).
//   • Para un servidor REAL use seed.produccion.ts (solo crea el director inicial).
//
// Decisiones de performance (~26.000 filas, ~15 s):
//   - bcrypt se calcula UNA vez por contraseña y se reutiliza el hash.
//   - Catálogos con upsert (re-ejecutable); bulk (notas/asistencias) con
//     createMany + guarda `count > 0 → skip` (no duplican al re-ejecutar).
//   - Sin recalcularCalificacion(): una actividad por dimensión (peso 1), así el
//     promedio es directo y exacto (misma matemática que src/lib/calificacion.helper.ts):
//       promedioDim  = fraccion x puntajeMaximo(dimension)
//       promedioTrim = fraccion x 100  (pesos suman 1)
//   - Asistencia: % = (presentes + justificados) / total, igual que la aplicación.
//   - PromedioFinal NO se siembra: nace al cerrar T3 (es la prueba estrella).
//
// Ejecutar contra BD LIMPIA: pnpm prisma migrate reset --force (corre el seed solo)
// o pnpm db:seed. Re-ejecutar el mismo día es seguro (upserts + guards).

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { sembrarCatalogo, MATERIAS } from './seed.catalogo.js'

// ─── Guardas ANTES de abrir la conexión ──────────────────────────────────────
if (process.env.NODE_ENV === 'production' && process.env.SEED_PERMITIR_PRODUCCION !== 'si') {
  console.error('❌ Este seed es de DEMO y se niega a correr con NODE_ENV=production.')
  console.error('   Para un servidor real use prisma/seed.produccion.ts (pnpm db:seed:prod).')
  console.error('   Si de verdad quiere un demo público: SEED_PERMITIR_PRODUCCION=si y SEED_PASSWORD_DEMO=<clave>.')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('❌ Falta DATABASE_URL (defínela en el archivo .env).')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma  = new PrismaClient({ adapter })

// ─── Hashes calculados una sola vez ──────────────────────────────────────────
// Por defecto, las contraseñas de demo de siempre (el panel de pruebas del login las muestra
// SOLO en desarrollo). Con SEED_PASSWORD_DEMO TODAS las cuentas usan esa clave (demo público).
const PASS_DEMO = (process.env.SEED_PASSWORD_DEMO ?? '').trim()
let HASH: Record<string, string>
async function initHash() {
  if (PASS_DEMO) {
    if (PASS_DEMO.length < 8) throw new Error('SEED_PASSWORD_DEMO debe tener al menos 8 caracteres')
    const h = await bcrypt.hash(PASS_DEMO, 10)
    HASH = { admin: h, sec: h, doc: h, est: h, tut: h }
    return
  }
  const [admin, sec, doc, est, tut] = await Promise.all(
    ['admin1234', 'sec1234', 'doc1234', 'est1234', 'tut1234'].map(p => bcrypt.hash(p, 4))
  )
  HASH = { admin, sec, doc, est, tut }
}

// ─── Utilidades deterministas (mismo seed → mismos datos) ────────────────────
// ANCLA = "hoy" de la simulación (día de calendario). Todo el calendario sale de aquí.
function parseAncla(v?: string): Date {
  if (v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
    if (!m) throw new Error(`SEED_ANCLA inválida ("${v}"): usa AAAA-MM-DD`)
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  }
  const h = new Date()   // el día de calendario LOCAL de quien ejecuta, como medianoche UTC
  return new Date(Date.UTC(h.getFullYear(), h.getMonth(), h.getDate()))
}
const ANCLA = parseAncla(process.env.SEED_ANCLA)
const ANIO  = ANCLA.getUTCFullYear()

// Perfil de cierre (ver tabla en la cabecera): con SEED_T3_COMPLETO=si el T3 se
// siembra al 100% para probar el cierre completo desde el sistema; por defecto
// queda al ~85% con pendientes con nombre para la demo de defensa.
const T3_COMPLETO = (process.env.SEED_T3_COMPLETO ?? '').trim().toLowerCase() === 'si'

// Todas las fechas se construyen con Date.UTC: new Date(año, mes, día) usa la hora LOCAL y,
// en una zona al este de UTC, la columna DATE quedaba un día antes (asistencia en domingo).
const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d))
const ultimoDia = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()
const mesRel = (delta: number): { y: number; m: number } => {
  const d = new Date(Date.UTC(ANCLA.getUTCFullYear(), ANCLA.getUTCMonth() + delta, 1))
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
}
// Trimestres mensuales: T3 = mes de la ancla, T2 = el anterior, T1 = el anterior a ese.
const PER: Record<1 | 2 | 3, { y: number; m: number }> = { 1: mesRel(-2), 2: mesRel(-1), 3: mesRel(0) }
const SIG = [mesRel(1), mesRel(2), mesRel(3)]   // gestión siguiente (inactiva)
// En el trimestre abierto (T3) no hay fechas posteriores a la ancla.
const fechaTrim = (n: 1 | 2 | 3, dia: number): Date => utc(PER[n].y, PER[n].m, n === 3 ? Math.min(dia, ANCLA.getUTCDate()) : dia)
const primerDiaHabil = (y: number, m: number): Date => {
  let d = 1
  while ([0, 6].includes(utc(y, m, d).getUTCDay())) d++
  return utc(y, m, d)
}
const INSCRIPCION = primerDiaHabil(PER[1].y, PER[1].m)

// Días hábiles (lun-vie) del mes, sin pasar de `hasta` (no hay asistencia del futuro).
const diasHabiles = (y: number, m: number, hasta: Date): Date[] => {
  const dias: Date[] = []
  for (let d = 1; d <= ultimoDia(y, m); d++) {
    const f = utc(y, m, d)
    if (f.getUTCDay() >= 1 && f.getUTCDay() <= 5 && f.getTime() <= hasta.getTime()) dias.push(f)
  }
  return dias
}

// Perfil de asistencia por estudiante: 0 completa, 1 regular (~91%),
// 2 irregular (~70%), 3 crítica (~50%). Determinista, sin Math.random.
function estadoAsistencia(perfil: number, diaIdx: number, estIdx: number): 'PRESENTE' | 'AUSENTE' | 'RETRASO' {
  if (perfil === 0) return 'PRESENTE'
  if (perfil === 1) {
    if ((diaIdx + estIdx) % 23 === 0) return 'RETRASO'
    return (diaIdx + estIdx) % 11 === 0 ? 'AUSENTE' : 'PRESENTE'
  }
  if (perfil === 2) return (diaIdx * 3 + estIdx) % 10 < 7 ? 'PRESENTE' : 'AUSENTE'
  return (diaIdx + estIdx * 2) % 10 < 5 ? 'PRESENTE' : 'AUSENTE'
}

const NOMBRES = ['Diego', 'Camila', 'Santiago', 'Fernanda', 'Mateo', 'Paola', 'Andrés', 'Daniela', 'Gabriel', 'Natalia', 'Cristián', 'Alejandra', 'Rodrigo', 'Carla', 'Felipe', 'María', 'José', 'Rosa', 'Luis', 'Elena']
const APELLIDOS = ['Condori', 'Mamani', 'Quispe', 'Flores', 'Tarqui', 'Huanca', 'Choque', 'Apaza', 'Ticona', 'Cruz', 'Ramos', 'Vargas', 'Torres', 'Choquehuanca', 'Paco', 'Limachi']
const OCUPACIONES = ['Comerciante', 'Chofer', 'Costurera', 'Albañil', 'Enfermera', 'Agricultor', 'Artesana', 'Mecánico']
const CALLES = ['Av. Pagador', 'Calle Bolívar', 'Av. Cívica', 'Zona Los Ángeles', 'Urb. Bustillos', 'Calle Junín', 'Av. España', 'Zona Norte']
const MOTIVOS_JUSTIFICACION = ['Certificado médico', 'Permiso familiar', 'Trámite de documentos', 'Cita de control']

// ─── Estudiantes base heredados (casos de prueba del seed anterior) ──────────
const BASE_1A = [
  { username: 'est_ana',    ci: 'E001', nombre: 'Ana',    apellido: 'Condori Mamani' },
  { username: 'est_pedro',  ci: 'E002', nombre: 'Pedro',  apellido: 'Huanca Quispe' },
  { username: 'est_lucia',  ci: 'E003', nombre: 'Lucía',  apellido: 'Tarqui Flores' },
]
const BASE_1B = [
  { username: 'est_valeria', ci: 'E005', nombre: 'Valeria', apellido: 'Quispe Tarqui' },
]
const MIGUEL = { username: 'est_miguel', ci: 'E004', nombre: 'Miguel', apellido: 'Mamani Choque' }

// Evita mezclar la demo con datos reales o con otra gestión (dos gestiones "activas" rompen la app).
async function protegerBaseDeDatos() {
  const personas = await prisma.persona.count()
  const esDemo = (await prisma.persona.findUnique({ where: { ci: 'D001' } })) !== null
  if (personas > 0 && !esDemo && process.env.SEED_FORZAR !== 'si') {
    throw new Error(
      `La base ya tiene ${personas} personas que NO son de esta demo. Este seed es solo para bases de demo ` +
      '(use `pnpm prisma migrate reset` para vaciarla, o SEED_FORZAR=si bajo su responsabilidad).'
    )
  }
  // La app asume UNA gestión activa. Si ya hay una activa de otro año (p. ej. se sembró con otra
  // ancla), correr esto dejaría dos activas a la vez.
  const activa = await prisma.gestion.findFirst({ where: { activa: true }, select: { anio: true } })
  if (activa && activa.anio !== ANIO) {
    throw new Error(
      `La base ya tiene la gestión ${activa.anio} activa y esta demo activaría la ${ANIO}. ` +
      'Use `pnpm prisma migrate reset` para empezar de cero, o fije la misma fecha de antes con SEED_ANCLA=AAAA-MM-DD.'
    )
  }
}

async function main() {
  const ancla = ANCLA.toISOString().slice(0, 10)
  console.log(`🌱 Seed de DEMO — gestión ${ANIO} (ancla ${ancla}${process.env.SEED_ANCLA ? '' : ' = hoy'}): colegio completo ficticio...\n`)
  await protegerBaseDeDatos()
  await initHash()

  // ══════════════════════════════════════
  // INSTITUCIÓN
  // ══════════════════════════════════════
  const catalogo = await sembrarCatalogo(prisma)
  console.log('✓ Institución y 4 campos de saber')

  // ══════════════════════════════════════
  // GESTIONES 2025 (activa, mensual) y 2026 (inactiva, vacía)
  // ══════════════════════════════════════
  const gAct = await prisma.gestion.upsert({
    where: { anio: ANIO }, update: { activa: true },
    create: {
      anio: ANIO, descripcion: `Gestión Escolar ${ANIO} (simulación mensual)`, activa: true,
      fechaInicio: utc(PER[1].y, PER[1].m, 1), fechaFin: utc(PER[3].y, PER[3].m, ultimoDia(PER[3].y, PER[3].m)),
      notaMinimaAprobacion: 51,
    },
  })
  const gSig = await prisma.gestion.upsert({
    where: { anio: ANIO + 1 }, update: {},
    create: {
      anio: ANIO + 1, descripcion: `Gestión Escolar ${ANIO + 1} (lista para promoción)`, activa: false,
      fechaInicio: utc(SIG[0].y, SIG[0].m, 1), fechaFin: utc(SIG[2].y, SIG[2].m, ultimoDia(SIG[2].y, SIG[2].m)),
      notaMinimaAprobacion: 51,
    },
  })
  console.log(`✓ Gestiones ${ANIO} (activa) y ${ANIO + 1} (inactiva)`)

  // ══════════════════════════════════════
  // DIMENSIONES (ambas gestiones, pesos = 100%)
  // ══════════════════════════════════════
  const dimDatos = [
    { nombre: 'Ser',     puntajeMaximo: 5,  pesoEnPromedio: 0.05, orden: 1, esAutoevaluada: true },
    { nombre: 'Saber',   puntajeMaximo: 45, pesoEnPromedio: 0.45, orden: 2, esAutoevaluada: false },
    { nombre: 'Hacer',   puntajeMaximo: 40, pesoEnPromedio: 0.40, orden: 3, esAutoevaluada: false },
    { nombre: 'Decidir', puntajeMaximo: 10, pesoEnPromedio: 0.10, orden: 4, esAutoevaluada: false },
  ]
  const dimsAct: Record<string, { id: number; puntajeMaximo: unknown }> = {}
  for (const g of [gAct, gSig]) {
    for (const d of dimDatos) {
      const dim = await prisma.dimensionEvaluacion.upsert({
        where: { gestionId_nombre: { gestionId: g.id, nombre: d.nombre } },
        update: {}, create: { gestionId: g.id, ...d },
      })
      if (g.id === gAct.id) dimsAct[d.nombre] = dim
    }
  }
  console.log('✓ Dimensiones Ser/Saber/Hacer/Decidir (ambas gestiones)')

  // ══════════════════════════════════════
  // TRIMESTRES MENSUALES — T1+T2 cerrados, T3 abierto; 2026 vacía
  // ══════════════════════════════════════
  const mesCompleto = (p: { y: number; m: number }): [Date, Date] => [utc(p.y, p.m, 1), utc(p.y, p.m, ultimoDia(p.y, p.m))]
  const trimDefs: Record<number, Array<[number, string, Date, Date, boolean]>> = {
    [gAct.id]: [
      [1, 'Primer Trimestre',  ...mesCompleto(PER[1]), true],
      [2, 'Segundo Trimestre', ...mesCompleto(PER[2]), true],
      [3, 'Tercer Trimestre',  ...mesCompleto(PER[3]), false],
    ],
    [gSig.id]: [
      [1, 'Primer Trimestre',  ...mesCompleto(SIG[0]), false],
      [2, 'Segundo Trimestre', ...mesCompleto(SIG[1]), false],
      [3, 'Tercer Trimestre',  ...mesCompleto(SIG[2]), false],
    ],
  }
  const trimsAct: Record<number, { id: number }> = {}
  for (const [gid, defs] of Object.entries(trimDefs)) {
    for (const [num, nombre, ini, fin, cerrado] of defs) {
      const t = await prisma.trimestre.upsert({
        where: { numero_gestionId: { numero: num, gestionId: Number(gid) } },
        update: { cerrado },
        create: { numero: num, nombre, gestionId: Number(gid), fechaInicio: ini, fechaFin: fin, cerrado },
      })
      if (Number(gid) === gAct.id) trimsAct[num] = t
    }
  }
  const trimNumPorId: Record<number, 1 | 2 | 3> = { [trimsAct[1].id]: 1, [trimsAct[2].id]: 2, [trimsAct[3].id]: 3 }
  console.log('✓ Trimestres mensuales (T1+T2 cerrados, T3 = mes en curso y abierto; gestión siguiente vacía)')

  // ══════════════════════════════════════
  // CURSOS 1°-6° x A/B (2025) — tutor = docente rotativo (ver asignaciones)
  // ══════════════════════════════════════
  type CursoRow = { id: number; grado: number; paralelo: string }
  const cursos: CursoRow[] = []
  for (let grado = 1; grado <= 6; grado++) {
    for (const paralelo of ['A', 'B']) {
      const c = await prisma.curso.upsert({
        where: { nivel_grado_paralelo_turno_gestionId: { nivel: 'SECUNDARIA', grado, paralelo, turno: 'MANANA', gestionId: gAct.id } },
        update: {},
        create: { nivel: 'SECUNDARIA', grado, paralelo, turno: 'MANANA', capacidad: 30, gestionId: gAct.id },
      })
      cursos.push({ id: c.id, grado, paralelo })
    }
  }
  console.log('✓ 12 cursos (1°-6° x A/B)')

  // ══════════════════════════════════════
  // MATERIAS (8 asignadas + QUECHUA libre → alerta dashboard)
  // ══════════════════════════════════════
  const materias = catalogo.materias
  const MATS_ASIGNADAS = ['MAT', 'LEN', 'CNA', 'CSO', 'ING', 'EFI', 'ART', 'TEC']
  const HORAS: Record<string, number> = Object.fromEntries(MATERIAS.map(m => [m.codigo, m.horas]))
  console.log('✓ 9 materias con campo de saber (QUECHUA sin asignar a propósito)')

  // ══════════════════════════════════════
  // USUARIOS base (cartel intacto) + DOCENTES nuevos
  // ══════════════════════════════════════
  async function upsertUsuario(username: string, hash: string, roles: Array<'DIRECTOR' | 'SECRETARIA' | 'DOCENTE' | 'ESTUDIANTE' | 'TUTOR'>) {
    return prisma.usuario.upsert({
      where: { username }, update: {},
      create: { username, passwordHash: hash, roles: [...roles], activo: true },
    })
  }
  const uDirector   = await upsertUsuario('director',   HASH.admin, ['DIRECTOR', 'DOCENTE'])
  const uSecretaria = await upsertUsuario('secretaria', HASH.sec,  ['SECRETARIA'])
  const U: Record<string, { id: number }> = {
    director: uDirector, secretaria: uSecretaria,
    doc_mamani:  await upsertUsuario('doc_mamani',  HASH.doc, ['DOCENTE']),
    doc_quispe:  await upsertUsuario('doc_quispe',  HASH.doc, ['DOCENTE']),
    doc_flores:  await upsertUsuario('doc_flores',  HASH.doc, ['DOCENTE']),
    doc_condori: await upsertUsuario('doc_condori', HASH.doc, ['DOCENTE']),
    doc_rios:     await upsertUsuario('doc_rios',     HASH.doc, ['DOCENTE']),
    doc_paredes:  await upsertUsuario('doc_paredes',  HASH.doc, ['DOCENTE']),
    doc_soto:     await upsertUsuario('doc_soto',     HASH.doc, ['DOCENTE']),
    doc_aliaga:   await upsertUsuario('doc_aliaga',   HASH.doc, ['DOCENTE']),
    doc_libre:    await upsertUsuario('doc_libre',    HASH.doc, ['DOCENTE']),
    tut_elena:    await upsertUsuario('tut_elena',    HASH.tut, ['TUTOR', 'DOCENTE']),
    tut_rosa:     await upsertUsuario('tut_rosa',     HASH.tut, ['TUTOR']),
    tut_miguel:   await upsertUsuario('tut_miguel',   HASH.tut, ['TUTOR']),
    tut_carmen:   await upsertUsuario('tut_carmen',   HASH.tut, ['TUTOR']),
  }

  async function crearPersona(d: { ci: string; nombre: string; apellido: string; telefono?: string; email?: string; fechaNacimiento?: Date; direccion?: string }) {
    return prisma.persona.upsert({ where: { ci: d.ci }, update: {}, create: d })
  }
  const pDirector = await crearPersona({ ci: 'D001', nombre: 'Roberto', apellido: 'Vargas Mamani', telefono: '71000001', email: 'r.vargas@ue-angeles.edu.bo' })
  const director = await prisma.director.upsert({
    where: { personaId: pDirector.id }, update: {},
    create: { personaId: pDirector.id, usuarioId: U.director.id, activo: true },
  })
  await prisma.gestion.update({ where: { id: gAct.id }, data: { directorId: director.id } })
  const pSec = await crearPersona({ ci: 'S001', nombre: 'Carmen', apellido: 'Flores Quispe', telefono: '72000001', email: 'c.flores@ue-angeles.edu.bo' })
  await prisma.secretaria.upsert({ where: { personaId: pSec.id }, update: {}, create: { personaId: pSec.id, usuarioId: U.secretaria.id, activo: true } })

  // Docentes: 5 heredados + 6 nuevos (libre sin carga, elena tutora-docente sin carga)
  const docSeed: Array<{ u: string; ci: string; nombre: string; apellido: string; esp: string; conCarga: boolean }> = [
    { u: 'director',    ci: 'D001',    nombre: 'Roberto', apellido: 'Vargas Mamani',  esp: 'Artes Plásticas',          conCarga: true },
    { u: 'doc_mamani',  ci: '1234567', nombre: 'Juan',    apellido: 'Mamani Condori', esp: 'Matemáticas',              conCarga: true },
    { u: 'doc_quispe',  ci: '2345678', nombre: 'María',   apellido: 'Quispe Tarqui',  esp: 'Lenguaje y Literatura',    conCarga: true },
    { u: 'doc_flores',  ci: '3456789', nombre: 'Carlos',  apellido: 'Flores Huanca',  esp: 'Inglés y Ed. Física',      conCarga: true },
    { u: 'doc_condori', ci: '4567890', nombre: 'Sofía',   apellido: 'Condori Mamani', esp: 'Ciencias Nat. y Sociales', conCarga: true },
    { u: 'doc_rios',    ci: 'D2001',   nombre: 'Elena',   apellido: 'Ríos Paco',      esp: 'Educación Musical',        conCarga: true },
    { u: 'doc_paredes', ci: 'D2002',   nombre: 'Marco',   apellido: 'Paredes Cruz',   esp: 'Artes Plásticas',          conCarga: true },
    { u: 'doc_soto',    ci: 'D2003',   nombre: 'Nadia',   apellido: 'Soto Ramos',     esp: 'Técnica Tecnológica',      conCarga: true },
    { u: 'doc_aliaga',  ci: 'D2004',   nombre: 'Pablo',   apellido: 'Aliaga Torres',  esp: 'Ciencias Sociales',        conCarga: true },
    { u: 'doc_libre',   ci: 'D2005',   nombre: 'Ruth',    apellido: 'Limachi Apaza',  esp: 'Lenguaje',                 conCarga: false },
  ]
  const docentes: Record<string, { id: number }> = {}
  for (const d of docSeed) {
    const ya = d.ci === 'D001' ? pDirector : await crearPersona({ ci: d.ci, nombre: d.nombre, apellido: d.apellido })
    docentes[d.u] = await prisma.docente.upsert({
      where: { personaId: ya.id }, update: {},
      create: { personaId: ya.id, usuarioId: U[d.u].id, especialidad: d.esp, activo: true },
    })
  }
  // Elena Ticona: tutora Y docente (multi-rol, sin carga → también alerta)
  const pElena = await crearPersona({ ci: 'T2001', nombre: 'Elena', apellido: 'Ticona Apaza', telefono: '79100001' })
  const tutElena = await prisma.tutor.upsert({
    where: { personaId: pElena.id }, update: {},
    create: { personaId: pElena.id, usuarioId: U.tut_elena.id, ocupacion: 'Docente', gradoInstruccion: 'Superior', activo: true },
  })
  await prisma.docente.upsert({
    where: { personaId: pElena.id }, update: {},
    create: { personaId: pElena.id, usuarioId: U.tut_elena.id, especialidad: 'Lenguaje', activo: true },
  })
  console.log('✓ Usuarios base + 11 docentes (libre sin carga, elena tutora-docente)')

  // Tutores heredados (vínculos originales)
  async function crearTutor(ci: string, nombre: string, apellido: string, username: string, ocupacion: string) {
    const p = await crearPersona({ ci, nombre, apellido })
    return prisma.tutor.upsert({
      where: { personaId: p.id }, update: {},
      create: { personaId: p.id, usuarioId: U[username].id, ocupacion, activo: true },
    })
  }
  const tutRosa   = await crearTutor('T001', 'Rosa',   'Condori Mamani', 'tut_rosa',   'Comerciante')
  const tutMiguel = await crearTutor('T002', 'Miguel', 'Huanca Torres',  'tut_miguel', 'Chofer')
  const tutCarmen = await crearTutor('T003', 'Carmen', 'Tarqui Flores',  'tut_carmen', 'Costurera')

  // ══════════════════════════════════════
  // ASIGNACIONES DMC: 12 cursos x 8 materias, rotando 9 docentes
  // ══════════════════════════════════════
  const poolDocentes = ['doc_mamani', 'doc_quispe', 'doc_flores', 'doc_condori', 'doc_rios', 'doc_paredes', 'doc_soto', 'doc_aliaga', 'director']
  const dmcs: Array<{ id: number; cursoIdx: number; materia: string; docenteId: number }> = []
  for (let ci = 0; ci < cursos.length; ci++) {
    for (let k = 0; k < MATS_ASIGNADAS.length; k++) {
      const du = poolDocentes[(ci + k) % poolDocentes.length]
      const dmc = await prisma.docenteMateriaCurso.upsert({
        where: { docenteId_materiaId_cursoId_gestionId: { docenteId: docentes[du].id, materiaId: materias[MATS_ASIGNADAS[k]].id, cursoId: cursos[ci].id, gestionId: gAct.id } },
        update: {},
        create: { docenteId: docentes[du].id, materiaId: materias[MATS_ASIGNADAS[k]].id, cursoId: cursos[ci].id, gestionId: gAct.id },
      })
      dmcs.push({ id: dmc.id, cursoIdx: ci, materia: MATS_ASIGNADAS[k], docenteId: docentes[du].id })
    }
    // Tutor del curso = primer docente rotado (para el explorador del dashboard)
    await prisma.curso.update({ where: { id: cursos[ci].id }, data: { tutorDocenteId: docentes[poolDocentes[ci % poolDocentes.length]].id } })
  }
  console.log(`✓ ${dmcs.length} asignaciones (96 DMC) + tutores de curso`)

  // ══════════════════════════════════════
  // HORARIOS: 4 cursos (1°A, 1°B, 2°A, 2°B) completos y SIN choques de docente ni de curso
  // ══════════════════════════════════════
  // Un horario de los 12 cursos es imposible con 9 docentes: 12 cursos x 29 h = 348 h/semana
  // y 9 docentes x 30 períodos = 270. Con 4 cursos son 116 h y ningún docente pasa de ~18 h.
  const CURSOS_CON_HORARIO = [0, 1, 2, 3]
  const HORAS_SEMANA = MATS_ASIGNADAS.reduce((t, c) => t + HORAS[c], 0)
  if ((await prisma.horario.count()) === 0) {
    const PERIODOS: Array<[string, string]> = [['08:00', '08:45'], ['08:45', '09:30'], ['09:30', '10:15'], ['10:30', '11:15'], ['11:15', '12:00'], ['12:00', '12:45']]
    const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES'] as const
    const hora = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`)
    const docenteOcupado = new Set<string>()
    const bloques: Array<{ docenteMateriaCursoId: number; diaSemana: (typeof DIAS)[number]; horaInicio: Date; horaFin: Date; aula: string }> = []

    for (const ci of CURSOS_CON_HORARIO) {
      const pend = MATS_ASIGNADAS.map(cod => ({
        dmc: dmcs.find(d => d.cursoIdx === ci && d.materia === cod)!,
        restante: HORAS[cod],
        porDia: new Map<number, number>(),
      }))
      const slotLleno = new Set<string>()
      // Recorre período x día; en cada hueco pone la materia con más horas pendientes cuyo
      // docente esté libre. 1.ª pasada: máx. 2 horas de una materia por día; 2.ª: sin ese límite.
      const colocar = (maxPorDia: number) => {
        for (let p = 0; p < PERIODOS.length; p++) {
          for (let d = 0; d < DIAS.length; d++) {
            if (slotLleno.has(`${d}|${p}`)) continue
            const x = pend
              .filter(c => c.restante > 0 && (c.porDia.get(d) ?? 0) < maxPorDia && !docenteOcupado.has(`${c.dmc.docenteId}|${d}|${p}`))
              .sort((a, b) => b.restante - a.restante || ((a.dmc.id + d + p) % 7) - ((b.dmc.id + d + p) % 7))[0]
            if (!x) continue
            x.restante--
            x.porDia.set(d, (x.porDia.get(d) ?? 0) + 1)
            slotLleno.add(`${d}|${p}`)
            docenteOcupado.add(`${x.dmc.docenteId}|${d}|${p}`)
            bloques.push({
              docenteMateriaCursoId: x.dmc.id, diaSemana: DIAS[d],
              horaInicio: hora(PERIODOS[p][0]), horaFin: hora(PERIODOS[p][1]),
              aula: `Aula ${cursos[ci].grado}°${cursos[ci].paralelo}`,
            })
          }
        }
      }
      colocar(2)
      colocar(5)
      const faltan = pend.filter(c => c.restante > 0)
      if (faltan.length) throw new Error(`No se pudo armar el horario del curso ${ci}: faltan horas de ${faltan.map(f => f.dmc.materia).join(', ')}`)
    }
    await prisma.horario.createMany({ data: bloques })
    console.log(`✓ ${bloques.length} bloques de horario en ${CURSOS_CON_HORARIO.length} cursos (sin choques)`)
  } else {
    console.log('→ Horarios ya sembrados, se omite')
  }

  // ══════════════════════════════════════
  // ESTUDIANTES + INSCRIPCIONES (6 por curso + Miguel retirado en 1°A)
  // ══════════════════════════════════════
  type EstRow = { id: number; inscId: number; globalIdx: number; nombre: string }
  const estudiantes: EstRow[] = []
  let nEst = 0, nTut = 10, nRude = 1
  const tutoresNuevos: Array<{ id: number; principal: boolean }> = []

  async function crearEstudiante(opts: {
    username: string; ci: string; nombre: string; apellido: string; rude: string;
    cursoIdx: number; fechaNac: string /* 'MM-DD': el año sale del grado */; estado?: 'ACTIVA' | 'RETIRADA'; fechaRetiro?: Date; obs?: string;
  }): Promise<EstRow> {
    const u = await upsertUsuario(opts.username, HASH.est, ['ESTUDIANTE'])
    const p = await crearPersona({
      ci: opts.ci, nombre: opts.nombre, apellido: opts.apellido,
      // 1° secundaria ≈ 12-13 años, 6° ≈ 17-18: el año de nacimiento sale del grado y de la gestión
      fechaNacimiento: utc(ANIO - 11 - (Math.floor(opts.cursoIdx / 2) + 1) - (nEst % 2), Number(opts.fechaNac.slice(0, 2)), Number(opts.fechaNac.slice(3, 5))),
      direccion: `${CALLES[nEst % CALLES.length]} ${100 + nEst}, Oruro`,
    })
    const e = await prisma.estudiante.upsert({
      where: { personaId: p.id }, update: {},
      create: { personaId: p.id, usuarioId: u.id, rude: opts.rude, activo: true },
    })
    const insc = await prisma.inscripcion.upsert({
      where: { estudianteId_gestionId: { estudianteId: e.id, gestionId: gAct.id } },
      update: {},
      create: {
        estudianteId: e.id, cursoId: cursos[opts.cursoIdx].id, gestionId: gAct.id,
        fechaInscripcion: INSCRIPCION,
        estadoInscripcion: opts.estado ?? 'ACTIVA',
        ...(opts.fechaRetiro ? { fechaRetiro: opts.fechaRetiro } : {}),
        ...(opts.obs ? { observaciones: opts.obs } : {}),
      },
    })
    const row = { id: e.id, inscId: insc.id, globalIdx: nEst, nombre: `${opts.nombre} ${opts.apellido}` }
    estudiantes.push(row)
    nEst++
    return row
  }

  // 1°A: base heredada + 3 nuevos (Miguel retirado aparte)
  for (const b of BASE_1A) {
    await crearEstudiante({ username: b.username, ci: b.ci, nombre: b.nombre, apellido: b.apellido, rude: `R${ANIO}${String(1000 + nRude++).padStart(4, '0')}`, cursoIdx: 0, fechaNac: '03-15' })
  }
  const miguel = await crearEstudiante({
    username: MIGUEL.username, ci: MIGUEL.ci, nombre: MIGUEL.nombre, apellido: MIGUEL.apellido,
    rude: `R${ANIO}${String(1000 + nRude++).padStart(4, '0')}`, cursoIdx: 0, fechaNac: '01-30',
    estado: 'RETIRADA', fechaRetiro: utc(PER[2].y, PER[2].m, 10), obs: 'Familia se trasladó a otro departamento',
  })
  // 1°B: Valeria + resto nuevo; demás cursos: 6 nuevos c/u
  await crearEstudiante({ username: BASE_1B[0].username, ci: BASE_1B[0].ci, nombre: BASE_1B[0].nombre, apellido: BASE_1B[0].apellido, rude: `R${ANIO}${String(1000 + nRude++).padStart(4, '0')}`, cursoIdx: 1, fechaNac: '05-17' })
  const porCurso = [3, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6] // nuevos por curso (1°A..6°B)
  for (let ci = 0; ci < 12; ci++) {
    for (let k = 0; k < porCurso[ci]; k++) {
      const gi = nEst
      const nombre = NOMBRES[(gi * 7) % NOMBRES.length]
      const apellido = `${APELLIDOS[(gi * 5) % APELLIDOS.length]} ${APELLIDOS[(gi * 11 + 3) % APELLIDOS.length]}`
      await crearEstudiante({
        username: `est_s${String(gi + 1).padStart(2, '0')}`, ci: `E${2001 + gi}`,
        nombre, apellido, rude: `R${ANIO}${String(1000 + nRude++).padStart(4, '0')}`,
        cursoIdx: ci, fechaNac: `${String(1 + (gi % 12)).padStart(2, '0')}-15`,
      })
    }
  }
  console.log(`✓ ${estudiantes.length} estudiantes inscritos (72 activos + Miguel retirado)`)

  // ══════════════════════════════════════
  // TUTORES nuevos (1:1, cada 12° comparte → ~6 compartidos) + vínculos base
  // ══════════════════════════════════════
  async function vincular(tutorId: number, estudianteId: number, parentesco: 'MADRE' | 'PADRE', principal: boolean) {
    await prisma.tutorEstudiante.upsert({
      where: { tutorId_estudianteId: { tutorId, estudianteId } },
      update: {},
      create: { tutorId, estudianteId, parentesco, esTutorPrincipal: principal, esApoderado: principal, viveConEstudiante: true },
    })
  }
  const ana = estudiantes[0], pedro = estudiantes[1], lucia = estudiantes[2]
  const valeria = estudiantes.find(e => e.nombre.startsWith('Valeria'))!
  await vincular(tutRosa.id, ana.id, 'MADRE', true)
  await vincular(tutRosa.id, miguel.id, 'MADRE', false)
  await vincular(tutMiguel.id, pedro.id, 'PADRE', true)
  await vincular(tutCarmen.id, lucia.id, 'MADRE', true)
  await vincular(tutCarmen.id, valeria.id, 'MADRE', false)
  // Elena tutora de 1 estudiante nuevo de 2°A (globalIdx 13)
  const ahijadoElena = estudiantes.find(e => e.globalIdx === 13)!
  await vincular(tutElena.id, ahijadoElena.id, 'MADRE', true)

  let ultimoTutorId = 0
  for (const e of estudiantes) {
    if (['Ana Condori', 'Pedro Huanca', 'Lucía Tarqui', 'Miguel Mamani', 'Valeria Quispe'].some(n => e.nombre.startsWith(n))) continue
    if (e.globalIdx === ahijadoElena.globalIdx) continue
    if (e.globalIdx % 12 === 11 && ultimoTutorId) {
      await vincular(ultimoTutorId, e.id, e.globalIdx % 2 ? 'MADRE' : 'PADRE', false) // comparte tutor (hermanos)
      continue
    }
    nTut++
    const username = `tut_t${String(nTut).padStart(2, '0')}`
    const u = await upsertUsuario(username, HASH.tut, ['TUTOR'])
    const p = await crearPersona({ ci: `T${2000 + nTut}`, nombre: NOMBRES[(nTut * 3) % NOMBRES.length], apellido: `${APELLIDOS[(nTut * 7) % APELLIDOS.length]} ${APELLIDOS[(nTut * 13) % APELLIDOS.length]}`, telefono: `79${String(100000 + nTut)}` })
    const t = await prisma.tutor.upsert({
      where: { personaId: p.id }, update: {},
      create: { personaId: p.id, usuarioId: u.id, ocupacion: OCUPACIONES[nTut % OCUPACIONES.length], activo: true },
    })
    tutoresNuevos.push({ id: t.id, principal: true })
    await vincular(t.id, e.id, nTut % 2 ? 'MADRE' : 'PADRE', true)
    ultimoTutorId = t.id
  }
  console.log(`✓ Tutores 1:1 + compartidos (hermanos) + vínculos base`)

  // ══════════════════════════════════════
  // NOTAS + PROMEDIOS (bulk; 1 actividad por dimensión, peso 1)
  // T1+T2 completos (cerrados), T3 al ~85% (abierto, globalIdx%7==0 sin nota)
  // ══════════════════════════════════════
  const hayNotas = await prisma.notaActividad.count()
  const frac = (gi: number, trim: number, salt: number) => Math.round((0.55 + ((gi * (37 + trim * 16 + salt) % 40)) / 100) * 100) / 100
  if (hayNotas > 0) {
    console.log('→ Notas ya sembradas, se omite el bulk (re-ejecución segura)')
  } else {
    const trimNum: Record<number, number> = { [trimsAct[1].id]: 1, [trimsAct[2].id]: 2, [trimsAct[3].id]: 3 }
    const dimNombres = ['Ser', 'Saber', 'Hacer', 'Decidir']
    const actNombres: Record<string, string> = { Ser: 'Autoevaluación de valores', Saber: 'Examen escrito', Hacer: 'Trabajo práctico', Decidir: 'Participación y proyecto' }
    const dimMax: Record<string, number> = { Ser: 5, Saber: 100, Hacer: 100, Decidir: 100 }
    const trimIds = [trimsAct[1].id, trimsAct[2].id, trimsAct[3].id]

    // 1) Actividades (bulk) — 96 DMC x 3 trim x 4 dim
    const acts: Array<{ docenteMateriaCursoId: number; trimestreId: number; dimensionId: number; nombre: string; puntajeMaximo: number; peso: number; fecha: Date; activo: boolean }> = []
    for (const dmc of dmcs) {
      for (const tid of trimIds) {
        for (const dn of dimNombres) {
          acts.push({
            docenteMateriaCursoId: dmc.id, trimestreId: tid, dimensionId: (dimsAct[dn] as { id: number }).id,
            nombre: actNombres[dn], puntajeMaximo: dimMax[dn], peso: 1,
            fecha: fechaTrim(trimNumPorId[tid], 15), activo: true,
          })
        }
      }
    }
    const CH = 500
    for (let i = 0; i < acts.length; i += CH) await prisma.actividadEvaluativa.createMany({ data: acts.slice(i, i + CH) })
    const actsDb: Array<{ id: number; docenteMateriaCursoId: number; trimestreId: number; dimensionId: number }> = await prisma.actividadEvaluativa.findMany({
      where: { docenteMateriaCursoId: { in: dmcs.map(d => d.id) } },
      select: { id: true, docenteMateriaCursoId: true, trimestreId: true, dimensionId: true },
    })
    const actId = new Map(actsDb.map(a => [`${a.docenteMateriaCursoId}-${a.trimestreId}-${a.dimensionId}`, a.id]))
    console.log(`✓ ${actsDb.length} actividades evaluativas`)

    // 2) Notas (bulk) — Miguel solo T1 (frac 0.45); empate exacto en 1°A T1/T2
    const inscPorCurso: Record<number, EstRow[]> = {}
    for (const e of estudiantes) {
      const insc = await prisma.inscripcion.findUnique({ where: { id: e.inscId }, select: { cursoId: true, estadoInscripcion: true } })
      if (!insc || insc.estadoInscripcion !== 'ACTIVA') continue
      const ci = cursos.findIndex(c => c.id === insc.cursoId)
      ;(inscPorCurso[ci] ??= []).push(e)
    }
    const notas: Array<{ actividadEvaluativaId: number; inscripcionId: number; nota: number }> = []
    const empate = [5, 6] // globalIdx de 2 nuevos de 1°A → empate exacto T1/T2
    for (const dmc of dmcs) {
      for (const tid of trimIds) {
        const tnum = trimNum[tid]
        for (const dn of dimNombres) {
          const aid = actId.get(`${dmc.id}-${tid}-${(dimsAct[dn] as { id: number }).id}`)!
          for (const e of (inscPorCurso[dmc.cursoIdx] ?? [])) {
            if (!T3_COMPLETO && tnum === 3 && e.globalIdx % 7 === 0) continue // T3 parcial → pendientes
            let f = frac(e.globalIdx, tnum, dmc.id % 5)
            if (empate.includes(e.globalIdx) && tnum <= 2) f = tnum === 1 ? 0.8 : 0.82
            const nota = Math.round(dimMax[dn] * f * 100) / 100
            notas.push({ actividadEvaluativaId: aid, inscripcionId: e.inscId, nota })
          }
        }
      }
    }
    for (let i = 0; i < notas.length; i += 1000) await prisma.notaActividad.createMany({ data: notas.slice(i, i + 1000) })
    console.log(`✓ ${notas.length} notas de actividad`)

    // 3) Calificaciones + dimensiones (bulk, matemática exacta del helper)
    const califs: Array<{ inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; promedioTrimestral: number }> = []
    for (const dmc of dmcs) {
      for (const tid of trimIds) {
        const tnum = trimNum[tid]
        for (const e of (inscPorCurso[dmc.cursoIdx] ?? [])) {
          if (!T3_COMPLETO && tnum === 3 && e.globalIdx % 7 === 0) continue
          let f = frac(e.globalIdx, tnum, dmc.id % 5)
          if (empate.includes(e.globalIdx) && tnum <= 2) f = tnum === 1 ? 0.8 : 0.82
          califs.push({ inscripcionId: e.inscId, docenteMateriaCursoId: dmc.id, trimestreId: tid, promedioTrimestral: Math.round(f * 100 * 100) / 100 })
        }
      }
    }
    for (let i = 0; i < califs.length; i += 1000) await prisma.calificacion.createMany({ data: califs.slice(i, i + 1000) })
    const califsDb: Array<{ id: number; inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number }> = await prisma.calificacion.findMany({ select: { id: true, inscripcionId: true, docenteMateriaCursoId: true, trimestreId: true } })
    const calId = new Map(califsDb.map(c => [`${c.inscripcionId}-${c.docenteMateriaCursoId}-${c.trimestreId}`, c.id]))
    const calDims: Array<{ calificacionId: number; dimensionId: number; promedio: number }> = []
    for (const dmc of dmcs) {
      for (const tid of trimIds) {
        const tnum = trimNum[tid]
        for (const e of (inscPorCurso[dmc.cursoIdx] ?? [])) {
          if (!T3_COMPLETO && tnum === 3 && e.globalIdx % 7 === 0) continue
          let f = frac(e.globalIdx, tnum, dmc.id % 5)
          if (empate.includes(e.globalIdx) && tnum <= 2) f = tnum === 1 ? 0.8 : 0.82
          const cid = calId.get(`${e.inscId}-${dmc.id}-${tid}`)!
          calDims.push(
            { calificacionId: cid, dimensionId: (dimsAct.Ser as { id: number }).id, promedio: Math.round(f * 5 * 100) / 100 },
            { calificacionId: cid, dimensionId: (dimsAct.Saber as { id: number }).id, promedio: Math.round(f * 45 * 100) / 100 },
            { calificacionId: cid, dimensionId: (dimsAct.Hacer as { id: number }).id, promedio: Math.round(f * 40 * 100) / 100 },
            { calificacionId: cid, dimensionId: (dimsAct.Decidir as { id: number }).id, promedio: Math.round(f * 10 * 100) / 100 },
          )
        }
      }
    }
    for (let i = 0; i < calDims.length; i += 1000) await prisma.calificacionDimension.createMany({ data: calDims.slice(i, i + 1000) })
    console.log(`✓ ${califsDb.length} calificaciones + ${calDims.length} dimensiones`)

    // 4) Miguel: T1 (frac 0.45) + historial 45→48→50 (caso corrección heredado)
    const dmcMat1A = dmcs.find(d => d.cursoIdx === 0 && d.materia === 'MAT')!
    for (const dn of dimNombres) {
      const aid = actId.get(`${dmcMat1A.id}-${trimsAct[1].id}-${(dimsAct[dn] as { id: number }).id}`)!
      await prisma.notaActividad.upsert({
        where: { actividadEvaluativaId_inscripcionId: { actividadEvaluativaId: aid, inscripcionId: miguel.inscId } },
        update: {}, create: { actividadEvaluativaId: aid, inscripcionId: miguel.inscId, nota: Math.round(dimMax[dn] * 0.45 * 100) / 100, registradoPorId: U.doc_mamani.id },
      })
    }
    const calMig = await prisma.calificacion.upsert({
      where: { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: miguel.inscId, docenteMateriaCursoId: dmcMat1A.id, trimestreId: trimsAct[1].id } },
      update: { promedioTrimestral: 50 }, create: { inscripcionId: miguel.inscId, docenteMateriaCursoId: dmcMat1A.id, trimestreId: trimsAct[1].id, promedioTrimestral: 50 },
    })
    for (const d of await prisma.calificacionDimension.findMany({ where: { calificacionId: calMig.id } })) {
      await prisma.calificacionDimension.delete({ where: { id: d.id } })
    }
    const dims = [[dimsAct.Ser, 5], [dimsAct.Saber, 45], [dimsAct.Hacer, 40], [dimsAct.Decidir, 10]] as const
    for (const [dim, max] of dims) {
      await prisma.calificacionDimension.create({ data: { calificacionId: calMig.id, dimensionId: (dim as { id: number }).id, promedio: Math.round(0.5 * Number(max) * 100) / 100 } })
    }
    await prisma.historialCalificacion.create({ data: { promedioAnterior: 45, promedioNuevo: 48, motivo: 'Revisión de prueba de recuperación', usuarioId: U.doc_mamani.id, calificacionId: calMig.id } })
    await prisma.historialCalificacion.create({ data: { promedioAnterior: 48, promedioNuevo: 50, motivo: 'Segunda revisión autorizada por director', usuarioId: U.director.id, calificacionId: calMig.id } })
    console.log('✓ Historial Miguel (45→48→50)')
  }

  // ══════════════════════════════════════
  // ASISTENCIA (bulk; 2 materias por curso: MAT y LEN) + resúmenes calculados
  // ══════════════════════════════════════
  if (await prisma.asistencia.count() > 0) {
    console.log('→ Asistencia ya sembrada, se omite el bulk')
  } else {
    const trimIds = [trimsAct[1].id, trimsAct[2].id, trimsAct[3].id]
    type EstadoAsist = 'PRESENTE' | 'AUSENTE' | 'RETRASO' | 'JUSTIFICADO'
    const rows: Array<{ inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; fecha: Date; estado: EstadoAsist; justificacion?: string }> = []
    for (let ci = 0; ci < cursos.length; ci++) {
      const cursoDmcs = dmcs.filter(d => d.cursoIdx === ci && (d.materia === 'MAT' || d.materia === 'LEN'))
      const delCurso = await prisma.inscripcion.findMany({
        where: { cursoId: cursos[ci].id, gestionId: gAct.id, estadoInscripcion: 'ACTIVA' },
        select: { id: true, estudianteId: true },
      })
      const giOf = new Map(estudiantes.map(e => [e.inscId, e.globalIdx]))
      for (const dmc of cursoDmcs) {
        for (const tid of trimIds) {
          const dias = diasHabiles(PER[trimNumPorId[tid]].y, PER[trimNumPorId[tid]].m, ANCLA)
          dias.forEach((fecha, di) => {
            for (const insc of delCurso) {
              const gi = giOf.get(insc.id) ?? 0
              const perfil = gi % 4
              let estado: EstadoAsist = estadoAsistencia(perfil, di, gi)
              let justificacion: string | undefined
              // Algunas ausencias llegan con justificativo (el cuarto estado que la app también maneja)
              if (estado === 'AUSENTE' && (di + gi) % 4 === 0) { estado = 'JUSTIFICADO'; justificacion = MOTIVOS_JUSTIFICACION[(di + gi) % MOTIVOS_JUSTIFICACION.length] }
              rows.push({ inscripcionId: insc.id, docenteMateriaCursoId: dmc.id, trimestreId: tid, fecha, estado, ...(justificacion ? { justificacion } : {}) })
            }
          })
        }
      }
    }
    for (let i = 0; i < rows.length; i += 1000) {
      await prisma.asistencia.createMany({ data: rows.slice(i, i + 1000) })
    }
    // Resúmenes calculados de lo generado (fuente: las filas de arriba)
    const grupos = new Map<string, { p: number; a: number; r: number; j: number; t: number }>()
    for (const r of rows) {
      const k = `${r.inscripcionId}-${r.docenteMateriaCursoId}-${r.trimestreId}`
      const g = grupos.get(k) ?? { p: 0, a: 0, r: 0, j: 0, t: 0 }
      if (r.estado === 'PRESENTE') g.p++
      else if (r.estado === 'AUSENTE') g.a++
      else if (r.estado === 'JUSTIFICADO') g.j++
      else g.r++
      g.t++
      grupos.set(k, g)
    }
    const res: Array<{ inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; totalClases: number; totalPresente: number; totalAusente: number; totalRetraso: number; totalJustificado: number; porcentaje: number }> = []
    for (const [k, g] of grupos) {
      const [inscId, dmcId, tid] = k.split('-').map(Number)
      res.push({
        inscripcionId: inscId, docenteMateriaCursoId: dmcId, trimestreId: tid,
        totalClases: g.t, totalPresente: g.p, totalAusente: g.a, totalRetraso: g.r, totalJustificado: g.j,
        // igual que la aplicación: (presentes + justificados) / total
        porcentaje: Math.round(((g.p + g.j) / g.t) * 100 * 100) / 100,
      })
    }
    for (let i = 0; i < res.length; i += 500) await prisma.resumenAsistencia.createMany({ data: res.slice(i, i + 500) })
    console.log(`✓ ${rows.length} asistencias + ${res.length} resúmenes`)
  }

  // ══════════════════════════════════════
  // PAGOS (junio 2025): PAGADO / PARCIAL / PENDIENTE / ANULADO / sin pagar
  // ══════════════════════════════════════
  if (await prisma.pago.count() > 0) {
    console.log('→ Pagos ya sembrados, se omite')
  } else {
    const cp = async (nombre: string, monto: number, obligatorio: boolean, desc: string) => {
      const ex = await prisma.conceptoPago.findFirst({ where: { nombre, gestionId: gAct.id } })
      return ex ?? prisma.conceptoPago.create({ data: { nombre, descripcion: desc, monto, obligatorio, gestionId: gAct.id } })
    }
    const cpMat = await cp(`Matrícula ${ANIO}`, 150, true, `Pago de matrícula gestión ${ANIO}.`)
    const cpDid = await cp('Material Didáctico', 80, true, 'Contribución para material y fotocopias.')
    const cpMan = await cp('Mantenimiento Infraestructura', 50, false, 'Contribución voluntaria de mantenimiento.')
    let rec = 1
    const mkRecibo = () => `REC-${PER[1].y}-${String(rec++).padStart(4, '0')}`
    const pagos: Array<{ inscripcionId: number; conceptoPagoId: number; montoOriginal: number; montoPagado: number; metodoPago: 'EFECTIVO' | 'TRANSFERENCIA' | 'QR'; estado: 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'ANULADO'; numeroRecibo: string; registradoPorId: number; fechaPago: Date }> = []
    const fechaPago = utc(PER[1].y, PER[1].m, 5)
    for (const e of estudiantes) {
      const insc = await prisma.inscripcion.findUnique({ where: { id: e.inscId } })
      if (!insc || insc.estadoInscripcion !== 'ACTIVA') {
        if (e.inscId === miguel.inscId) {
          pagos.push({ inscripcionId: e.inscId, conceptoPagoId: cpMat.id, montoOriginal: 150, montoPagado: 150, metodoPago: 'EFECTIVO', estado: 'ANULADO', numeroRecibo: mkRecibo(), registradoPorId: U.secretaria.id, fechaPago })
        }
        continue
      }
      if (e.nombre.startsWith('Valeria') || e.globalIdx % 5 === 4) continue // sin pagar
      if (e.nombre.startsWith('Pedro')) {
        pagos.push({ inscripcionId: e.inscId, conceptoPagoId: cpMat.id, montoOriginal: 150, montoPagado: 100, metodoPago: 'TRANSFERENCIA', estado: 'PARCIAL', numeroRecibo: mkRecibo(), registradoPorId: U.secretaria.id, fechaPago })
        continue
      }
      if (e.globalIdx === 8) {
        pagos.push({ inscripcionId: e.inscId, conceptoPagoId: cpMat.id, montoOriginal: 150, montoPagado: 0, metodoPago: 'EFECTIVO', estado: 'PENDIENTE', numeroRecibo: mkRecibo(), registradoPorId: U.secretaria.id, fechaPago })
        continue
      }
      pagos.push({ inscripcionId: e.inscId, conceptoPagoId: cpMat.id, montoOriginal: 150, montoPagado: 150, metodoPago: 'EFECTIVO', estado: 'PAGADO', numeroRecibo: mkRecibo(), registradoPorId: U.secretaria.id, fechaPago })
      pagos.push({ inscripcionId: e.inscId, conceptoPagoId: cpDid.id, montoOriginal: 80, montoPagado: 80, metodoPago: 'EFECTIVO', estado: 'PAGADO', numeroRecibo: mkRecibo(), registradoPorId: U.secretaria.id, fechaPago })
      if (e.globalIdx % 3 === 0) {
        pagos.push({ inscripcionId: e.inscId, conceptoPagoId: cpMan.id, montoOriginal: 50, montoPagado: 50, metodoPago: 'QR', estado: 'PAGADO', numeroRecibo: mkRecibo(), registradoPorId: U.secretaria.id, fechaPago })
      }
    }
    for (let i = 0; i < pagos.length; i += 500) await prisma.pago.createMany({ data: pagos.slice(i, i + 500) })
    console.log(`✓ ${pagos.length} pagos (PARCIAL/PENDIENTE/ANULADO/sin pagar incluidos)`)
  }

  // ══════════════════════════════════════
  // BITÁCORA (2 cursos, dentro de su mes)
  // ══════════════════════════════════════
  if ((await prisma.bitacoraClase.count()) === 0) {
    const dmcMat1A = dmcs.find(d => d.cursoIdx === 0 && d.materia === 'MAT')!
    const dmcLen1B = dmcs.find(d => d.cursoIdx === 1 && d.materia === 'LEN')!
    const temas: Array<[number, number, Date, string, string, string]> = [
      [dmcMat1A.id, trimsAct[1].id, fechaTrim(1, 3),  'Números enteros', 'Introducción a operaciones básicas.', 'Ejercicios pág. 15-16'],
      [dmcMat1A.id, trimsAct[1].id, fechaTrim(1, 10), 'Fracciones', 'Operaciones con fracciones propias.', 'Taller de fracciones'],
      [dmcMat1A.id, trimsAct[2].id, fechaTrim(2, 8),  'Decimales', 'Representación y operaciones.', 'Ejercicios pág. 22-23'],
      [dmcMat1A.id, trimsAct[2].id, fechaTrim(2, 22), 'Porcentajes', 'Cálculo en problemas cotidianos.', '10 problemas de aplicación'],
      [dmcMat1A.id, trimsAct[3].id, fechaTrim(3, 5),  'Álgebra — variables', 'Concepto de variable y expresiones.', 'Pág. 35 — identificar vars'],
      [dmcLen1B.id, trimsAct[1].id, fechaTrim(1, 4),  'Comprensión lectora', 'Lectura guiada y preguntas.', 'Cuestionario pág. 8'],
      [dmcLen1B.id, trimsAct[2].id, fechaTrim(2, 9),  'Gramática: el verbo', 'Conjugación en presente.', 'Ejercicios pág. 30'],
      [dmcLen1B.id, trimsAct[3].id, fechaTrim(3, 6),  'Redacción', 'Texto descriptivo.', 'Redactar 1 página'],
    ]
    for (const [dmcId, tid, fecha, tema, descripcion, tareaAsignada] of temas) {
      await prisma.bitacoraClase.create({ data: { docenteMateriaCursoId: dmcId, trimestreId: tid, fecha, tema, descripcion, tareaAsignada } })
    }
    console.log('✓ Bitácora (8 registros en 1°A-MAT y 1°B-LEN)')
  } else {
    console.log('→ Bitácora ya sembrada, se omite')
  }

  // ══════════════════════════════════════
  // VERIFICACIÓN — si algo no cumple, el seed FALLA (código de salida 1)
  // ══════════════════════════════════════
  console.log('\n── Verificación ──')
  const fallos: string[] = []
  const verificar = (nombre: string, ok: boolean, detalle: string) => {
    console.log(`${ok ? '✓' : '✗'} ${nombre}: ${detalle}`)
    if (!ok) fallos.push(nombre)
  }
  const nInsc = await prisma.inscripcion.count({ where: { gestionId: gAct.id } })
  verificar('inscripciones', nInsc === 73, `${nInsc} (esperado 73)`)

  const t3SinNota = await prisma.inscripcion.count({
    where: { gestionId: gAct.id, estadoInscripcion: 'ACTIVA', calificaciones: { none: { trimestreId: trimsAct[3].id } } },
  })
  verificar(
    T3_COMPLETO ? 'T3 sin calificar (cierre completo)' : 'T3 sin calificar (pendientes demo)',
    T3_COMPLETO ? t3SinNota === 0 : t3SinNota > 0,
    `${t3SinNota} (esperado ${T3_COMPLETO ? 0 : '> 0'})`,
  )

  const sumaPesos = await prisma.dimensionEvaluacion.aggregate({ where: { gestionId: gAct.id }, _sum: { pesoEnPromedio: true } })
  verificar('suma de pesos de dimensiones', Number(sumaPesos._sum.pesoEnPromedio) === 1, `${Number(sumaPesos._sum.pesoEnPromedio)} (esperado 1)`)

  const materiasSinCampo = await prisma.materia.count({ where: { campoSaberId: null } })
  verificar('materias con campo de saber', materiasSinCampo === 0, `${materiasSinCampo} sin campo (esperado 0)`)

  const nHorarios = await prisma.horario.count()
  verificar('bloques de horario', nHorarios === CURSOS_CON_HORARIO.length * HORAS_SEMANA, `${nHorarios} (esperado ${CURSOS_CON_HORARIO.length * HORAS_SEMANA})`)
  const [{ n: choques }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n
    FROM "Horario" a
    JOIN "DocenteMateriaCurso" da ON da.id = a."docenteMateriaCursoId"
    JOIN "Horario" b ON b.id > a.id AND b."diaSemana" = a."diaSemana" AND a."horaInicio" < b."horaFin" AND b."horaInicio" < a."horaFin"
    JOIN "DocenteMateriaCurso" db ON db.id = b."docenteMateriaCursoId"
    WHERE da."docenteId" = db."docenteId" OR da."cursoId" = db."cursoId"`
  verificar('choques de horario (docente o curso)', Number(choques) === 0, `${choques} (esperado 0)`)

  const [{ n: finDeSemana }] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Asistencia" WHERE extract(isodow FROM "fecha") IN (6, 7)`
  verificar('asistencias en sábado o domingo', Number(finDeSemana) === 0, `${finDeSemana} (esperado 0)`)
  const futuras = await prisma.asistencia.count({ where: { fecha: { gt: ANCLA } } })
  verificar('asistencias posteriores a la ancla', futuras === 0, `${futuras} (esperado 0)`)

  console.log(`\nnotas: ${await prisma.notaActividad.count()} | calificaciones: ${await prisma.calificacion.count()} | asistencias: ${await prisma.asistencia.count()} | pagos: ${await prisma.pago.count()}`)
  if (fallos.length) throw new Error(`Verificación fallida: ${fallos.join('; ')}`)

  console.log('\n════════════════════════════════════════════════════════')
  console.log('✅ Seed de demo completada')
  console.log('════════════════════════════════════════════════════════')
  if (PASS_DEMO) {
    console.log('\nCUENTAS (todas con la contraseña de SEED_PASSWORD_DEMO):')
  } else {
    console.log('\nCREDENCIALES (solo desarrollo; hash reusado por rol):')
  }
  const clave = (p: string) => (PASS_DEMO ? '<SEED_PASSWORD_DEMO>' : p)
  console.log(`  director/${clave('admin1234')} (DIRECTOR+DOCENTE) · secretaria/${clave('sec1234')}`)
  console.log(`  doc_mamani|quispe|flores|condori|rios|paredes|soto|aliaga|libre / ${clave('doc1234')}`)
  console.log(`  est_ana|est_pedro|est_lucia|est_miguel|est_valeria + est_s01.. / ${clave('est1234')}`)
  console.log(`  tut_rosa|tut_miguel|tut_carmen|tut_elena(DOCENTE+TUTOR) + tut_t.. / ${clave('tut1234')}`)
  console.log('\nCASOS DE PRUEBA:')
  console.log('  Miguel → RETIRADO + historial MAT T1 (45→48→50)')
  console.log('  Valeria → sin pagos · Pedro → matrícula PARCIAL · 1 PENDIENTE · perfiles ~50% asistencia (con justificadas)')
  console.log('  Empate exacto en 1°A T1/T2 (ranking) · QUECHUA sin asignar · Ruth Limachi sin carga')
  console.log('  Horarios completos en 1°A, 1°B, 2°A, 2°B (sin choques) · boletín agrupado por campo de saber')
  console.log(T3_COMPLETO
    ? '  T3 = mes en curso, 100% calificado: cerrar desde la UI debe completarse y materializar PromedioFinal'
    : '  T3 = mes en curso, ~85% calificado: cerrar desde la UI debe pedir lo faltante (widget con nombres)')
  console.log(`  Gestión ${ANIO + 1} inactiva y vacía: probar promoción + propuesta de inscripciones + activación`)
}

main()
  .catch(e => {
    console.error('\n❌ Seed falló:', e)
    process.exitCode = 1   // antes: .catch(console.error) → salía con 0 y parecía exitoso
  })
  .finally(() => prisma.$disconnect())