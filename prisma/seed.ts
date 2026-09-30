// prisma/seed.ts
// Semilla ROBUSTA de simulación (schema v6) — colegio completo ficticio:
//
//   12 cursos (1°-6° x A/B, SECUNDARIA) x 6 estudiantes = 72 activos
//   + Miguel (RETIRADO, caso de prueba heredado) = 73 inscripciones 2025
//   ~66 tutores (mayoría 1:1, 6 compartidos + tutora multi-rol)
//   11 docentes (9 enseñando + 1 libre + 1 tutora-docente sin carga)
//   9 materias (8 asignadas + QUECHUA libre a propósito → alerta dashboard)
//   Trimestres MENSUALES 2025: T1=junio, T2=julio, T3=agosto (T1+T2 cerrados,
//   T3 abierto al ~85% → pendientes con nombres + cierre manual como prueba)
//   Gestión 2026 creada INACTIVA (T1=sep, T2=oct, T3=nov 2025, vacía) para
//   probar promoción / propuesta de inscripciones / activación.
//
// Decisiones de performance (esto es ~25.000 filas):
//   - bcrypt se calcula UNA vez por contraseña y se reutiliza el hash.
//   - Catálogos con upsert (re-ejecutable); bulk (notas/asistencias) con
//     createMany + guarda `count > 0 → skip` (no duplican al re-ejecutar).
//   - Sin recalcularCalificacion(): el seed usa UNA actividad por dimensión
//     (peso 1), así el promedio es directo y exacto (ver notaEnDimension):
//       promedioDim  = fraccion x puntajeMaximo(dimension)
//       promedioTrim = fraccion x 100  (pesos suman 1)
//     Misma matemática que src/lib/calificacion.helper.ts, sin 15k queries.
//   - PromedioFinal NO se siembra: nace al cerrar T3 (es la prueba estrella).
//
// Ejecutar contra BD LIMPIA: pnpm prisma migrate reset --force (corre el
// seed solo) o pnpm db:seed. Re-ejecutar es seguro (upserts + guards).
// SOLO dev — nunca contra producción.

import bcrypt from 'bcryptjs'
import { PrismaClient } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' })
const prisma  = new PrismaClient({ adapter })

// ─── Hashes calculados una sola vez ──────────────────────────────────────────
let HASH: Record<string, string>
async function initHash() {
  const [admin, sec, doc, est, tut] = await Promise.all(
    ['admin1234', 'sec1234', 'doc1234', 'est1234', 'tut1234'].map(p => bcrypt.hash(p, 4))
  )
  HASH = { admin, sec, doc, est, tut }
}

// ─── Utilidades deterministas (mismo seed → mismos datos) ────────────────────
const diasHabiles = (anio: number, mes: number): Date[] => {
  const dias: Date[] = []
  const n = new Date(anio, mes, 0).getDate()
  for (let d = 1; d <= n; d++) {
    const f = new Date(anio, mes - 1, d)
    if (f.getDay() >= 1 && f.getDay() <= 5) dias.push(f)
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

async function main() {
  console.log('🌱 Seed robusta 2025 + 2026 (colegio completo ficticio)...\n')
  await initHash()

  // ══════════════════════════════════════
  // INSTITUCIÓN
  // ══════════════════════════════════════
  await prisma.institucion.upsert({
    where: { id: 1 }, update: {},
    create: {
      id: 1, nombre: 'Unidad Educativa "Los Ángeles de Nazaria Ignacia"',
      direccion: 'Urbanización Bustillos, Zona Los Ángeles', telefono: '(052) 123456',
      email: 'ue.angeles.nazaria@gmail.com', rue: '81230370',
      municipio: 'Oruro', departamento: 'Oruro', dependencia: 'FISCAL',
    },
  })
  console.log('✓ Institución')

  // ══════════════════════════════════════
  // GESTIONES 2025 (activa, mensual) y 2026 (inactiva, vacía)
  // ══════════════════════════════════════
  const g25 = await prisma.gestion.upsert({
    where: { anio: 2025 }, update: { activa: true },
    create: {
      anio: 2025, descripcion: 'Gestión Escolar 2025 (simulación mensual)', activa: true,
      fechaInicio: new Date('2025-06-01'), fechaFin: new Date('2025-08-31'),
      notaMinimaAprobacion: 51,
    },
  })
  const g26 = await prisma.gestion.upsert({
    where: { anio: 2026 }, update: {},
    create: {
      anio: 2026, descripcion: 'Gestión Escolar 2026 (lista para promoción)', activa: false,
      fechaInicio: new Date('2025-09-01'), fechaFin: new Date('2025-11-30'),
      notaMinimaAprobacion: 51,
    },
  })
  console.log('✓ Gestiones 2025 (activa) y 2026 (inactiva)')

  // ══════════════════════════════════════
  // DIMENSIONES (ambas gestiones, pesos = 100%)
  // ══════════════════════════════════════
  const dimDatos = [
    { nombre: 'Ser',     puntajeMaximo: 5,  pesoEnPromedio: 0.05, orden: 1, esAutoevaluada: true },
    { nombre: 'Saber',   puntajeMaximo: 45, pesoEnPromedio: 0.45, orden: 2, esAutoevaluada: false },
    { nombre: 'Hacer',   puntajeMaximo: 40, pesoEnPromedio: 0.40, orden: 3, esAutoevaluada: false },
    { nombre: 'Decidir', puntajeMaximo: 10, pesoEnPromedio: 0.10, orden: 4, esAutoevaluada: false },
  ]
  const dims25: Record<string, { id: number; puntajeMaximo: unknown }> = {}
  for (const g of [g25, g26]) {
    for (const d of dimDatos) {
      const dim = await prisma.dimensionEvaluacion.upsert({
        where: { gestionId_nombre: { gestionId: g.id, nombre: d.nombre } },
        update: {}, create: { gestionId: g.id, ...d },
      })
      if (g.id === g25.id) dims25[d.nombre] = dim
    }
  }
  console.log('✓ Dimensiones Ser/Saber/Hacer/Decidir (2025 y 2026)')

  // ══════════════════════════════════════
  // TRIMESTRES MENSUALES — T1+T2 cerrados, T3 abierto; 2026 vacía
  // ══════════════════════════════════════
  const trimDefs: Record<number, Array<[number, string, string, string, boolean]>> = {
    [g25.id]: [
      [1, 'Primer Trimestre',  '2025-06-01', '2025-06-30', true],
      [2, 'Segundo Trimestre', '2025-07-01', '2025-07-31', true],
      [3, 'Tercer Trimestre',  '2025-08-01', '2025-08-31', false],
    ],
    [g26.id]: [
      [1, 'Primer Trimestre',  '2025-09-01', '2025-09-30', false],
      [2, 'Segundo Trimestre', '2025-10-01', '2025-10-31', false],
      [3, 'Tercer Trimestre',  '2025-11-01', '2025-11-30', false],
    ],
  }
  const trims25: Record<number, { id: number }> = {}
  for (const [gid, defs] of Object.entries(trimDefs)) {
    for (const [num, nombre, ini, fin, cerrado] of defs) {
      const t = await prisma.trimestre.upsert({
        where: { numero_gestionId: { numero: num, gestionId: Number(gid) } },
        update: { cerrado },
        create: { numero: num, nombre, gestionId: Number(gid), fechaInicio: new Date(ini), fechaFin: new Date(fin), cerrado },
      })
      if (Number(gid) === g25.id) trims25[num] = t
    }
  }
  console.log('✓ Trimestres mensuales (T1+T2 cerrados, T3 abierto; 2026 vacía)')

  // ══════════════════════════════════════
  // CURSOS 1°-6° x A/B (2025) — tutor = docente rotativo (ver asignaciones)
  // ══════════════════════════════════════
  type CursoRow = { id: number; grado: number; paralelo: string }
  const cursos: CursoRow[] = []
  for (let grado = 1; grado <= 6; grado++) {
    for (const paralelo of ['A', 'B']) {
      const c = await prisma.curso.upsert({
        where: { nivel_grado_paralelo_turno_gestionId: { nivel: 'SECUNDARIA', grado, paralelo, turno: 'MANANA', gestionId: g25.id } },
        update: {},
        create: { nivel: 'SECUNDARIA', grado, paralelo, turno: 'MANANA', capacidad: 30, gestionId: g25.id },
      })
      cursos.push({ id: c.id, grado, paralelo })
    }
  }
  console.log('✓ 12 cursos (1°-6° x A/B)')

  // ══════════════════════════════════════
  // MATERIAS (8 asignadas + QUECHUA libre → alerta dashboard)
  // ══════════════════════════════════════
  const matDefs: Array<[string, string, number]> = [
    ['MAT', 'Matemáticas', 5], ['LEN', 'Lenguaje', 5], ['CNA', 'Ciencias Naturales', 4],
    ['CSO', 'Ciencias Sociales', 4], ['ING', 'Inglés', 3], ['EFI', 'Educación Física', 3],
    ['ART', 'Artes Plásticas', 2], ['TEC', 'Técnica Tecnológica', 3], ['QUE', 'Lengua Originaria (Quechua)', 2],
  ]
  const materias: Record<string, { id: number }> = {}
  for (const [codigo, nombre, hs] of matDefs) {
    materias[codigo] = await prisma.materia.upsert({ where: { codigo }, update: {}, create: { nombre, codigo, horasSemanales: hs } })
  }
  const MATS_ASIGNADAS = ['MAT', 'LEN', 'CNA', 'CSO', 'ING', 'EFI', 'ART', 'TEC']
  console.log('✓ 9 materias (QUECHUA sin asignar a propósito)')

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
  await prisma.gestion.update({ where: { id: g25.id }, data: { directorId: director.id } })
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
  const dmcs: Array<{ id: number; cursoIdx: number; materia: string }> = []
  for (let ci = 0; ci < cursos.length; ci++) {
    for (let k = 0; k < MATS_ASIGNADAS.length; k++) {
      const du = poolDocentes[(ci + k) % poolDocentes.length]
      const dmc = await prisma.docenteMateriaCurso.upsert({
        where: { docenteId_materiaId_cursoId_gestionId: { docenteId: docentes[du].id, materiaId: materias[MATS_ASIGNADAS[k]].id, cursoId: cursos[ci].id, gestionId: g25.id } },
        update: {},
        create: { docenteId: docentes[du].id, materiaId: materias[MATS_ASIGNADAS[k]].id, cursoId: cursos[ci].id, gestionId: g25.id },
      })
      dmcs.push({ id: dmc.id, cursoIdx: ci, materia: MATS_ASIGNADAS[k] })
    }
    // Tutor del curso = primer docente rotado (para el explorador del dashboard)
    await prisma.curso.update({ where: { id: cursos[ci].id }, data: { tutorDocenteId: docentes[poolDocentes[ci % poolDocentes.length]].id } })
  }
  console.log(`✓ ${dmcs.length} asignaciones (96 DMC) + tutores de curso`)

  // ══════════════════════════════════════
  // ESTUDIANTES + INSCRIPCIONES (6 por curso + Miguel retirado en 1°A)
  // ══════════════════════════════════════
  type EstRow = { id: number; inscId: number; globalIdx: number; nombre: string }
  const estudiantes: EstRow[] = []
  let nEst = 0, nTut = 10, nRude = 1
  const tutoresNuevos: Array<{ id: number; principal: boolean }> = []

  async function crearEstudiante(opts: {
    username: string; ci: string; nombre: string; apellido: string; rude: string;
    cursoIdx: number; fechaNac: string; estado?: 'ACTIVA' | 'RETIRADA'; fechaRetiro?: string; obs?: string;
  }): Promise<EstRow> {
    const u = await upsertUsuario(opts.username, HASH.est, ['ESTUDIANTE'])
    const p = await crearPersona({
      ci: opts.ci, nombre: opts.nombre, apellido: opts.apellido,
      fechaNacimiento: new Date(opts.fechaNac),
      direccion: `${CALLES[nEst % CALLES.length]} ${100 + nEst}, Oruro`,
    })
    const e = await prisma.estudiante.upsert({
      where: { personaId: p.id }, update: {},
      create: { personaId: p.id, usuarioId: u.id, rude: opts.rude, activo: true },
    })
    const insc = await prisma.inscripcion.upsert({
      where: { estudianteId_gestionId: { estudianteId: e.id, gestionId: g25.id } },
      update: {},
      create: {
        estudianteId: e.id, cursoId: cursos[opts.cursoIdx].id, gestionId: g25.id,
        fechaInscripcion: new Date('2025-06-02'),
        estadoInscripcion: opts.estado ?? 'ACTIVA',
        ...(opts.fechaRetiro ? { fechaRetiro: new Date(opts.fechaRetiro) } : {}),
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
    await crearEstudiante({ username: b.username, ci: b.ci, nombre: b.nombre, apellido: b.apellido, rude: `R2025${String(1000 + nRude++).padStart(4, '0')}`, cursoIdx: 0, fechaNac: '2010-03-15' })
  }
  const miguel = await crearEstudiante({
    username: MIGUEL.username, ci: MIGUEL.ci, nombre: MIGUEL.nombre, apellido: MIGUEL.apellido,
    rude: `R2025${String(1000 + nRude++).padStart(4, '0')}`, cursoIdx: 0, fechaNac: '2010-01-30',
    estado: 'RETIRADA', fechaRetiro: '2025-07-10', obs: 'Familia se trasladó a otro departamento',
  })
  // 1°B: Valeria + resto nuevo; demás cursos: 6 nuevos c/u
  await crearEstudiante({ username: BASE_1B[0].username, ci: BASE_1B[0].ci, nombre: BASE_1B[0].nombre, apellido: BASE_1B[0].apellido, rude: `R2025${String(1000 + nRude++).padStart(4, '0')}`, cursoIdx: 1, fechaNac: '2009-05-17' })
  const porCurso = [3, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6] // nuevos por curso (1°A..6°B)
  for (let ci = 0; ci < 12; ci++) {
    for (let k = 0; k < porCurso[ci]; k++) {
      const gi = nEst
      const nombre = NOMBRES[(gi * 7) % NOMBRES.length]
      const apellido = `${APELLIDOS[(gi * 5) % APELLIDOS.length]} ${APELLIDOS[(gi * 11 + 3) % APELLIDOS.length]}`
      await crearEstudiante({
        username: `est_s${String(gi + 1).padStart(2, '0')}`, ci: `E${2001 + gi}`,
        nombre, apellido, rude: `R2025${String(1000 + nRude++).padStart(4, '0')}`,
        cursoIdx: ci, fechaNac: `${2009 + (gi % 3)}-${String(1 + (gi % 12)).padStart(2, '0')}-15`,
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
    const trimNum: Record<number, number> = { [trims25[1].id]: 1, [trims25[2].id]: 2, [trims25[3].id]: 3 }
    const trimMes: Record<number, number> = { [trims25[1].id]: 6, [trims25[2].id]: 7, [trims25[3].id]: 8 }
    const dimNombres = ['Ser', 'Saber', 'Hacer', 'Decidir']
    const actNombres: Record<string, string> = { Ser: 'Autoevaluación de valores', Saber: 'Examen escrito', Hacer: 'Trabajo práctico', Decidir: 'Participación y proyecto' }
    const dimMax: Record<string, number> = { Ser: 5, Saber: 100, Hacer: 100, Decidir: 100 }
    const trimIds = [trims25[1].id, trims25[2].id, trims25[3].id]

    // 1) Actividades (bulk) — 96 DMC x 3 trim x 4 dim
    const acts: Array<{ docenteMateriaCursoId: number; trimestreId: number; dimensionId: number; nombre: string; puntajeMaximo: number; peso: number; fecha: Date; activo: boolean }> = []
    for (const dmc of dmcs) {
      for (const tid of trimIds) {
        for (const dn of dimNombres) {
          acts.push({
            docenteMateriaCursoId: dmc.id, trimestreId: tid, dimensionId: (dims25[dn] as { id: number }).id,
            nombre: actNombres[dn], puntajeMaximo: dimMax[dn], peso: 1,
            fecha: new Date(`2025-${String(trimMes[tid]).padStart(2, '0')}-15`), activo: true,
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
          const aid = actId.get(`${dmc.id}-${tid}-${(dims25[dn] as { id: number }).id}`)!
          for (const e of (inscPorCurso[dmc.cursoIdx] ?? [])) {
            if (tnum === 3 && e.globalIdx % 7 === 0) continue // T3 parcial → pendientes
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
          if (tnum === 3 && e.globalIdx % 7 === 0) continue
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
          if (tnum === 3 && e.globalIdx % 7 === 0) continue
          let f = frac(e.globalIdx, tnum, dmc.id % 5)
          if (empate.includes(e.globalIdx) && tnum <= 2) f = tnum === 1 ? 0.8 : 0.82
          const cid = calId.get(`${e.inscId}-${dmc.id}-${tid}`)!
          calDims.push(
            { calificacionId: cid, dimensionId: (dims25.Ser as { id: number }).id, promedio: Math.round(f * 5 * 100) / 100 },
            { calificacionId: cid, dimensionId: (dims25.Saber as { id: number }).id, promedio: Math.round(f * 45 * 100) / 100 },
            { calificacionId: cid, dimensionId: (dims25.Hacer as { id: number }).id, promedio: Math.round(f * 40 * 100) / 100 },
            { calificacionId: cid, dimensionId: (dims25.Decidir as { id: number }).id, promedio: Math.round(f * 10 * 100) / 100 },
          )
        }
      }
    }
    for (let i = 0; i < calDims.length; i += 1000) await prisma.calificacionDimension.createMany({ data: calDims.slice(i, i + 1000) })
    console.log(`✓ ${califsDb.length} calificaciones + ${calDims.length} dimensiones`)

    // 4) Miguel: T1 (frac 0.45) + historial 45→48→50 (caso corrección heredado)
    const dmcMat1A = dmcs.find(d => d.cursoIdx === 0 && d.materia === 'MAT')!
    for (const dn of dimNombres) {
      const aid = actId.get(`${dmcMat1A.id}-${trims25[1].id}-${(dims25[dn] as { id: number }).id}`)!
      await prisma.notaActividad.upsert({
        where: { actividadEvaluativaId_inscripcionId: { actividadEvaluativaId: aid, inscripcionId: miguel.inscId } },
        update: {}, create: { actividadEvaluativaId: aid, inscripcionId: miguel.inscId, nota: Math.round(dimMax[dn] * 0.45 * 100) / 100, registradoPorId: U.doc_mamani.id },
      })
    }
    const calMig = await prisma.calificacion.upsert({
      where: { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: miguel.inscId, docenteMateriaCursoId: dmcMat1A.id, trimestreId: trims25[1].id } },
      update: { promedioTrimestral: 50 }, create: { inscripcionId: miguel.inscId, docenteMateriaCursoId: dmcMat1A.id, trimestreId: trims25[1].id, promedioTrimestral: 50 },
    })
    for (const d of await prisma.calificacionDimension.findMany({ where: { calificacionId: calMig.id } })) {
      await prisma.calificacionDimension.delete({ where: { id: d.id } })
    }
    const dims = [[dims25.Ser, 5], [dims25.Saber, 45], [dims25.Hacer, 40], [dims25.Decidir, 10]] as const
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
    const trimIds = [trims25[1].id, trims25[2].id, trims25[3].id]
    const trimMes: Record<number, number> = { [trims25[1].id]: 6, [trims25[2].id]: 7, [trims25[3].id]: 8 }
    const rows: Array<{ inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; fecha: Date; estado: 'PRESENTE' | 'AUSENTE' | 'RETRASO' }> = []
    for (let ci = 0; ci < cursos.length; ci++) {
      const cursoDmcs = dmcs.filter(d => d.cursoIdx === ci && (d.materia === 'MAT' || d.materia === 'LEN'))
      const delCurso = await prisma.inscripcion.findMany({
        where: { cursoId: cursos[ci].id, gestionId: g25.id, estadoInscripcion: 'ACTIVA' },
        select: { id: true, estudianteId: true },
      })
      const giOf = new Map(estudiantes.map(e => [e.inscId, e.globalIdx]))
      for (const dmc of cursoDmcs) {
        for (const tid of trimIds) {
          const dias = diasHabiles(2025, trimMes[tid])
          dias.forEach((fecha, di) => {
            for (const insc of delCurso) {
              const gi = giOf.get(insc.id) ?? 0
              const perfil = gi % 4
              rows.push({ inscripcionId: insc.id, docenteMateriaCursoId: dmc.id, trimestreId: tid, fecha, estado: estadoAsistencia(perfil, di, gi) })
            }
          })
        }
      }
    }
    for (let i = 0; i < rows.length; i += 1000) {
      await prisma.asistencia.createMany({ data: rows.slice(i, i + 1000) })
    }
    // Resúmenes calculados de lo generado (fuente: las filas de arriba)
    const grupos = new Map<string, { p: number; a: number; r: number; t: number }>()
    for (const r of rows) {
      const k = `${r.inscripcionId}-${r.docenteMateriaCursoId}-${r.trimestreId}`
      const g = grupos.get(k) ?? { p: 0, a: 0, r: 0, t: 0 }
      if (r.estado === 'PRESENTE') g.p++
      else if (r.estado === 'AUSENTE') g.a++
      else g.r++
      g.t++
      grupos.set(k, g)
    }
    const res: Array<{ inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; totalClases: number; totalPresente: number; totalAusente: number; totalRetraso: number; totalJustificado: number; porcentaje: number }> = []
    for (const [k, g] of grupos) {
      const [inscId, dmcId, tid] = k.split('-').map(Number)
      res.push({
        inscripcionId: inscId, docenteMateriaCursoId: dmcId, trimestreId: tid,
        totalClases: g.t, totalPresente: g.p, totalAusente: g.a, totalRetraso: g.r, totalJustificado: 0,
        porcentaje: Math.round((g.p / g.t) * 100 * 100) / 100,
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
      const ex = await prisma.conceptoPago.findFirst({ where: { nombre, gestionId: g25.id } })
      return ex ?? prisma.conceptoPago.create({ data: { nombre, descripcion: desc, monto, obligatorio, gestionId: g25.id } })
    }
    const cpMat = await cp('Matrícula 2025', 150, true, 'Pago de matrícula gestión 2025.')
    const cpDid = await cp('Material Didáctico', 80, true, 'Contribución para material y fotocopias.')
    const cpMan = await cp('Mantenimiento Infraestructura', 50, false, 'Contribución voluntaria de mantenimiento.')
    let rec = 1
    const mkRecibo = () => `REC-2025-${String(rec++).padStart(4, '0')}`
    const pagos: Array<{ inscripcionId: number; conceptoPagoId: number; montoOriginal: number; montoPagado: number; metodoPago: 'EFECTIVO' | 'TRANSFERENCIA' | 'QR'; estado: 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'ANULADO'; numeroRecibo: string; registradoPorId: number; fechaPago: Date }> = []
    const fechaPago = new Date('2025-06-05')
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
    const temas: Array<[number, number, string, string, string, string]> = [
      [dmcMat1A.id, trims25[1].id, '2025-06-03', 'Números enteros', 'Introducción a operaciones básicas.', 'Ejercicios pág. 15-16'],
      [dmcMat1A.id, trims25[1].id, '2025-06-10', 'Fracciones', 'Operaciones con fracciones propias.', 'Taller de fracciones'],
      [dmcMat1A.id, trims25[2].id, '2025-07-08', 'Decimales', 'Representación y operaciones.', 'Ejercicios pág. 22-23'],
      [dmcMat1A.id, trims25[2].id, '2025-07-22', 'Porcentajes', 'Cálculo en problemas cotidianos.', '10 problemas de aplicación'],
      [dmcMat1A.id, trims25[3].id, '2025-08-05', 'Álgebra — variables', 'Concepto de variable y expresiones.', 'Pág. 35 — identificar vars'],
      [dmcLen1B.id, trims25[1].id, '2025-06-04', 'Comprensión lectora', 'Lectura guiada y preguntas.', 'Cuestionario pág. 8'],
      [dmcLen1B.id, trims25[2].id, '2025-07-09', 'Gramática: el verbo', 'Conjugación en presente.', 'Ejercicios pág. 30'],
      [dmcLen1B.id, trims25[3].id, '2025-08-06', 'Redacción', 'Texto descriptivo.', 'Redactar 1 página'],
    ]
    for (const [dmcId, tid, fecha, tema, desc, tarea] of temas) {
      await prisma.bitacoraClase.create({ data: { docenteMateriaCursoId: dmcId, trimestreId: tid, fecha: new Date(fecha as string), tema: tema as string, descripcion: desc as string, tareaAsignada: tarea as string } })
    }
    console.log('✓ Bitácora (8 registros en 1°A-MAT y 1°B-LEN)')
  } else {
    console.log('→ Bitácora ya sembrada, se omite')
  }

  // ══════════════════════════════════════
  // VERIFICACIÓN (conteos + invariantes, no falla: informa)
  // ══════════════════════════════════════
  console.log('\n── Verificación ──')
  const nInsc = await prisma.inscripcion.count({ where: { gestionId: g25.id } })
  const nNotas = await prisma.notaActividad.count()
  const nAsis = await prisma.asistencia.count()
  const nPagos = await prisma.pago.count()
  const nCal = await prisma.calificacion.count()
  const t3SinNota = await prisma.inscripcion.count({
    where: {
      gestionId: g25.id, estadoInscripcion: 'ACTIVA',
      calificaciones: { none: { trimestreId: trims25[3].id } },
    },
  })
  const sumaPesos = await prisma.dimensionEvaluacion.aggregate({ where: { gestionId: g25.id }, _sum: { pesoEnPromedio: true } })
  const allUsernames: Array<{ username: string }> = await prisma.usuario.findMany({ select: { username: true } })
  const vistos = new Set<string>()
  let usuariosDup = 0
  for (const u of allUsernames) {
    if (vistos.has(u.username)) usuariosDup++
    vistos.add(u.username)
  }
  console.log(`inscripciones 2025: ${nInsc} (esperado 73)`)
  console.log(`notas: ${nNotas} | calificaciones: ${nCal} | asistencias: ${nAsis} | pagos: ${nPagos}`)
  console.log(`T3 sin calificar (pendientes demo): ${t3SinNota} (esperado > 0)`)
  console.log(`suma pesos dimensiones: ${Number(sumaPesos._sum.pesoEnPromedio)} (esperado 1)`)
  console.log(`usernames duplicados: ${usuariosDup} (esperado 0)`)

  console.log('\n════════════════════════════════════════════════════════')
  console.log('✅ Seed robusta completada')
  console.log('════════════════════════════════════════════════════════')
  console.log('\nCREDENCIALES (hash reusado por rol):')
  console.log('  director/admin1234 (DIRECTOR+DOCENTE) · secretaria/sec1234')
  console.log('  doc_mamani|quispe|flores|condori|rios|paredes|soto|aliaga|libre / doc1234')
  console.log('  est_ana|est_pedro|est_lucia|est_miguel|est_valeria + est_s01.. / est1234')
  console.log('  tut_rosa|tut_miguel|tut_carmen|tut_elena(DOCENTE+TUTOR) + tut_t.. / tut1234')
  console.log('\nCASOS DE PRUEBA:')
  console.log('  Miguel → RETIRADO 10/07 + historial MAT T1 (45→48→50)')
  console.log('  Valeria → sin pagos · Pedro → matrícula PARCIAL · 1 PENDIENTE · perfiles ~50% asistencia')
  console.log('  Empate exacto en 1°A T1/T2 (ranking) · QUECHUA sin asignar · Ruth Limachi sin carga')
  console.log('  T3 al ~85%: cerrar desde la UI debe pedir lo faltante (widget con nombres)')
  console.log('  2026 inactiva y vacía: probar promoción + propuesta de inscripciones + activación')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
