// prisma/seed.ts
// Reescrito para el schema v6:
//   - Persona compartida (Director/Secretaria/Docente/Estudiante/Tutor
//     ya no tienen nombre/apellido/ci propios)
//   - Usuario.roles es un arreglo (se aprovecha para mostrar un caso de
//     multi-rol: el director también dicta una materia)
//   - Curso: nivel/grado/paralelo/turno en vez de "nombre"
//   - Calificaciones vía DimensionEvaluacion → ActividadEvaluativa →
//     NotaActividad, con el mismo cálculo que calificacion.helper.ts
//     (documentado ahí: promedio ponderado por dimensión, replicado acá
//     porque el seed usa su propia instancia de PrismaClient)
//   - Asistencia.trimestreId directo (ya no se infiere por fecha)
//   - HistorialCalificacion.promedioAnterior/promedioNuevo
//   - PromedioFinal.resultado (enum) — NO se crea en este seed porque
//     requiere notas de los 3 trimestres, y acá solo T1 está cerrado
//   - Actividad → BitacoraClase
//
// Ejecutar: pnpm db:seed

import bcrypt from 'bcryptjs'
import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' })
const prisma  = new PrismaClient({ adapter })

const hash = async (p: string) => bcrypt.hash(p, 12)

// Réplica minimalista de recalcularCalificacion() (ver
// src/lib/calificacion.helper.ts) para no depender de la app en el seed.
async function recalcularLocal(inscripcionId: number, docenteMateriaCursoId: number, trimestreId: number, gestionId: number) {
  const dimensiones = await prisma.dimensionEvaluacion.findMany({ where: { gestionId }, orderBy: { orden: 'asc' } })

  const calificacion = await prisma.calificacion.upsert({
    where:  { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId, docenteMateriaCursoId, trimestreId } },
    update: {},
    create: { inscripcionId, docenteMateriaCursoId, trimestreId },
  })

  let sumaPonderada = 0
  let sumaPesos     = 0

  for (const dimension of dimensiones) {
    const actividades = await prisma.actividadEvaluativa.findMany({
      where: { docenteMateriaCursoId, trimestreId, dimensionId: dimension.id, activo: true },
      include: { notas: { where: { inscripcionId } } },
    })
    const evaluadas = actividades.filter(a => a.notas.length > 0)
    if (evaluadas.length === 0) continue

    let sumaPctPonderada  = 0
    let sumaPesoActividad = 0
    for (const act of evaluadas) {
      const pct = Number(act.notas[0].nota) / Number(act.puntajeMaximo)
      sumaPctPonderada  += pct * Number(act.peso)
      sumaPesoActividad += Number(act.peso)
    }
    const pctDimension      = sumaPctPonderada / sumaPesoActividad
    const promedioDimension = pctDimension * Number(dimension.puntajeMaximo)

    await prisma.calificacionDimension.upsert({
      where:  { calificacionId_dimensionId: { calificacionId: calificacion.id, dimensionId: dimension.id } },
      update: { promedio: promedioDimension },
      create: { calificacionId: calificacion.id, dimensionId: dimension.id, promedio: promedioDimension },
    })

    sumaPonderada += pctDimension * Number(dimension.pesoEnPromedio)
    sumaPesos     += Number(dimension.pesoEnPromedio)
  }

  const promedioTrimestral = sumaPesos > 0 ? Math.round(sumaPonderada / sumaPesos * 100 * 100) / 100 : null
  return prisma.calificacion.update({ where: { id: calificacion.id }, data: { promedioTrimestral } })
}

async function main() {
  console.log('🌱 Iniciando seed (schema v6)...\n')

  // ══════════════════════════════════════
  // INSTITUCIÓN
  // ══════════════════════════════════════
  await prisma.institucion.upsert({
    where:  { id: 1 },
    update: {},
    create: {
      id: 1,
      nombre:       'Unidad Educativa "Los Ángeles de Nazaria Ignacia"',
      direccion:    'Urbanización Bustillos, Zona Los Ángeles',
      telefono:     '(052) 123456',
      email:        'ue.angeles.nazaria@gmail.com',
      rue:          '81230370',
      municipio:    'Oruro',
      departamento: 'Oruro',
      dependencia:  'FISCAL',
    },
  })
  console.log('✓ Institución configurada')

  // ══════════════════════════════════════
  // GESTIÓN
  // ══════════════════════════════════════
  const gestion = await prisma.gestion.upsert({
    where:  { anio: 2025 },
    update: {},
    create: {
      anio: 2025,
      descripcion: 'Gestión Escolar 2025',
      activa: true,
      fechaInicio: new Date('2025-02-03'),
      fechaFin:    new Date('2025-11-28'),
      notaMinimaAprobacion: 51,
    },
  })
  console.log(`✓ Gestión ${gestion.anio}`)

  // ══════════════════════════════════════
  // DIMENSIONES DE EVALUACIÓN (Ley 070: Ser/Saber/Hacer/Decidir)
  // ══════════════════════════════════════
  // pesoEnPromedio es Decimal(4,3) en el schema — precisión 4, escala 3,
  // o sea el máximo posible es 9.999. Va como FRACCIÓN (0-1), no como
  // porcentaje (45 desborda el campo). puntajeMaximo sí es Decimal(5,2)
  // y ahí sí entran 45/40/etc.
  const dimDatos = [
    { nombre: 'Ser',      puntajeMaximo: 5,   pesoEnPromedio: 0.05, orden: 1, esAutoevaluada: true  },
    { nombre: 'Saber',    puntajeMaximo: 45,  pesoEnPromedio: 0.45, orden: 2, esAutoevaluada: false },
    { nombre: 'Hacer',    puntajeMaximo: 40,  pesoEnPromedio: 0.40, orden: 3, esAutoevaluada: false },
    { nombre: 'Decidir',  puntajeMaximo: 10,  pesoEnPromedio: 0.10, orden: 4, esAutoevaluada: false },
  ]
  const [dSer, dSaber, dHacer, dDecidir] = await Promise.all(
    dimDatos.map(d => prisma.dimensionEvaluacion.upsert({
      where: { gestionId_nombre: { gestionId: gestion.id, nombre: d.nombre } },
      update: {},
      create: { gestionId: gestion.id, ...d },
    }))
  )
  console.log('✓ 4 dimensiones de evaluación (Ser/Saber/Hacer/Decidir)')

  // ══════════════════════════════════════
  // TRIMESTRES
  // ══════════════════════════════════════
  const [trim1, trim2, trim3] = await Promise.all([
    prisma.trimestre.upsert({
      where:  { numero_gestionId: { numero: 1, gestionId: gestion.id } }, update: {},
      create: { numero: 1, nombre: 'Primer Trimestre',  gestionId: gestion.id, fechaInicio: new Date('2025-02-03'), fechaFin: new Date('2025-05-02'), cerrado: true  },
    }),
    prisma.trimestre.upsert({
      where:  { numero_gestionId: { numero: 2, gestionId: gestion.id } }, update: {},
      create: { numero: 2, nombre: 'Segundo Trimestre', gestionId: gestion.id, fechaInicio: new Date('2025-05-05'), fechaFin: new Date('2025-08-01'), cerrado: false },
    }),
    prisma.trimestre.upsert({
      where:  { numero_gestionId: { numero: 3, gestionId: gestion.id } }, update: {},
      create: { numero: 3, nombre: 'Tercer Trimestre',  gestionId: gestion.id, fechaInicio: new Date('2025-08-04'), fechaFin: new Date('2025-11-28'), cerrado: false },
    }),
  ])
  console.log('✓ 3 trimestres (T1 cerrado)')

  // ══════════════════════════════════════
  // CURSOS — nivel/grado/paralelo/turno (ya no hay "nombre")
  // ══════════════════════════════════════
  const cursoDatos = [
    { nivel: 'SECUNDARIA' as const, grado: 1, paralelo: 'A' },
    { nivel: 'SECUNDARIA' as const, grado: 1, paralelo: 'B' },
    { nivel: 'SECUNDARIA' as const, grado: 2, paralelo: 'A' },
    { nivel: 'SECUNDARIA' as const, grado: 3, paralelo: 'A' },
    { nivel: 'SECUNDARIA' as const, grado: 4, paralelo: 'A' },
    { nivel: 'SECUNDARIA' as const, grado: 5, paralelo: 'A' },
    { nivel: 'SECUNDARIA' as const, grado: 6, paralelo: 'A' },
  ]
  const [c1A, c1B, c2A, c3A, c4A, c5A, c6A] = await Promise.all(
    cursoDatos.map(c => prisma.curso.upsert({
      where: { nivel_grado_paralelo_turno_gestionId: { nivel: c.nivel, grado: c.grado, paralelo: c.paralelo, turno: 'MANANA', gestionId: gestion.id } },
      update: {},
      create: { ...c, turno: 'MANANA', capacidad: 30, gestionId: gestion.id },
    }))
  )
  console.log('✓ 7 cursos (1° Secundaria A/B .. 6° Secundaria A)')

  // ══════════════════════════════════════
  // MATERIAS
  // ══════════════════════════════════════
  const [mMAT, mLEN, mCNA, mCSO, mING, mEFI, mART, mTEC] = await Promise.all([
    prisma.materia.upsert({ where: { codigo: 'MAT' }, update: {}, create: { nombre: 'Matemáticas',         codigo: 'MAT', horasSemanales: 5 } }),
    prisma.materia.upsert({ where: { codigo: 'LEN' }, update: {}, create: { nombre: 'Lenguaje',            codigo: 'LEN', horasSemanales: 5 } }),
    prisma.materia.upsert({ where: { codigo: 'CNA' }, update: {}, create: { nombre: 'Ciencias Naturales',  codigo: 'CNA', horasSemanales: 4 } }),
    prisma.materia.upsert({ where: { codigo: 'CSO' }, update: {}, create: { nombre: 'Ciencias Sociales',   codigo: 'CSO', horasSemanales: 4 } }),
    prisma.materia.upsert({ where: { codigo: 'ING' }, update: {}, create: { nombre: 'Inglés',              codigo: 'ING', horasSemanales: 3 } }),
    prisma.materia.upsert({ where: { codigo: 'EFI' }, update: {}, create: { nombre: 'Educación Física',    codigo: 'EFI', horasSemanales: 3 } }),
    prisma.materia.upsert({ where: { codigo: 'ART' }, update: {}, create: { nombre: 'Artes Plásticas',     codigo: 'ART', horasSemanales: 2 } }),
    prisma.materia.upsert({ where: { codigo: 'TEC' }, update: {}, create: { nombre: 'Técnica Tecnológica', codigo: 'TEC', horasSemanales: 3 } }),
  ])
  console.log('✓ 8 materias')

  // ══════════════════════════════════════
  // USUARIOS — roles es un arreglo ahora.
  // El director también dicta Artes Plásticas: caso de prueba de multi-rol.
  // ══════════════════════════════════════
  const usuarioDatos = [
    { username: 'director',    password: 'admin1234', roles: ['DIRECTOR', 'DOCENTE'] as const },
    { username: 'secretaria',  password: 'sec1234',   roles: ['SECRETARIA'] as const },
    { username: 'doc_mamani',  password: 'doc1234',   roles: ['DOCENTE'] as const },
    { username: 'doc_quispe',  password: 'doc1234',   roles: ['DOCENTE'] as const },
    { username: 'doc_flores',  password: 'doc1234',   roles: ['DOCENTE'] as const },
    { username: 'doc_condori', password: 'doc1234',   roles: ['DOCENTE'] as const },
    { username: 'est_ana',     password: 'est1234',   roles: ['ESTUDIANTE'] as const },
    { username: 'est_pedro',   password: 'est1234',   roles: ['ESTUDIANTE'] as const },
    { username: 'est_lucia',   password: 'est1234',   roles: ['ESTUDIANTE'] as const },
    { username: 'est_miguel',  password: 'est1234',   roles: ['ESTUDIANTE'] as const },
    { username: 'est_valeria', password: 'est1234',   roles: ['ESTUDIANTE'] as const },
    { username: 'tut_rosa',    password: 'tut1234',   roles: ['TUTOR'] as const },
    { username: 'tut_miguel',  password: 'tut1234',   roles: ['TUTOR'] as const },
    { username: 'tut_carmen',  password: 'tut1234',   roles: ['TUTOR'] as const },
  ]
  const usuarios: Record<string, { id: number }> = {}
  for (const u of usuarioDatos) {
    usuarios[u.username] = await prisma.usuario.upsert({
      where:  { username: u.username },
      update: {},
      create: { username: u.username, passwordHash: await hash(u.password), roles: [...u.roles], activo: true },
    })
  }
  console.log('✓ 14 usuarios (director con roles DIRECTOR + DOCENTE)')

  // ══════════════════════════════════════
  // PERSONAS + PERFILES
  // ══════════════════════════════════════
  async function crearPersona(datos: {
    ci: string; nombre: string; apellido: string; telefono?: string; email?: string; fechaNacimiento?: Date; direccion?: string
  }) {
    return prisma.persona.upsert({ where: { ci: datos.ci }, update: {}, create: datos })
  }

  const pDirector = await crearPersona({ ci: 'D001', nombre: 'Roberto', apellido: 'Vargas Mamani', telefono: '71000001', email: 'r.vargas@ue-angeles.edu.bo' })
  const director = await prisma.director.upsert({
    where: { personaId: pDirector.id }, update: {},
    create: { personaId: pDirector.id, usuarioId: usuarios['director'].id, activo: true },
  })
  await prisma.gestion.update({ where: { id: gestion.id }, data: { directorId: director.id } })
  console.log(`✓ Director: ${pDirector.nombre} ${pDirector.apellido} → asignado a gestión ${gestion.anio}`)

  const pSecretaria = await crearPersona({ ci: 'S001', nombre: 'Carmen', apellido: 'Flores Quispe', telefono: '72000001', email: 'c.flores@ue-angeles.edu.bo' })
  const secretaria = await prisma.secretaria.upsert({
    where: { personaId: pSecretaria.id }, update: {},
    create: { personaId: pSecretaria.id, usuarioId: usuarios['secretaria'].id, activo: true },
  })
  console.log(`✓ Secretaria: ${pSecretaria.nombre} ${pSecretaria.apellido}`)

  type DocenteSeed = {
    username: string; ci: string; nombre: string; apellido: string; especialidad: string
    telefono?: string; email?: string; persona?: typeof pDirector
  }
  const docenteDatos: DocenteSeed[] = [
    { username: 'director',    ci: 'D001',    nombre: 'Roberto', apellido: 'Vargas Mamani',  especialidad: 'Artes Plásticas',          persona: pDirector }, // multi-rol
    { username: 'doc_mamani',  ci: '1234567', nombre: 'Juan',   apellido: 'Mamani Condori', especialidad: 'Matemáticas',              telefono: '71234567', email: 'j.mamani@ue-angeles.edu.bo'  },
    { username: 'doc_quispe',  ci: '2345678', nombre: 'María',  apellido: 'Quispe Tarqui',  especialidad: 'Lenguaje y Literatura',    telefono: '72345678', email: 'm.quispe@ue-angeles.edu.bo'  },
    { username: 'doc_flores',  ci: '3456789', nombre: 'Carlos', apellido: 'Flores Huanca',  especialidad: 'Inglés y Ed. Física',      telefono: '73456789', email: 'c.flores2@ue-angeles.edu.bo' },
    { username: 'doc_condori', ci: '4567890', nombre: 'Sofía',  apellido: 'Condori Mamani', especialidad: 'Ciencias Nat. y Sociales', telefono: '74567890', email: 's.condori@ue-angeles.edu.bo' },
  ]
  const docentes: Record<string, { id: number }> = {}
  for (const d of docenteDatos) {
    const persona = d.persona ?? await crearPersona({ ci: d.ci, nombre: d.nombre, apellido: d.apellido, telefono: d.telefono, email: d.email })
    docentes[d.username] = await prisma.docente.upsert({
      where: { personaId: persona.id }, update: {},
      create: { personaId: persona.id, usuarioId: usuarios[d.username].id, especialidad: d.especialidad, activo: true },
    })
  }
  const doc1 = docentes['doc_mamani']   // Matemáticas
  const doc2 = docentes['doc_quispe']   // Lenguaje
  const doc3 = docentes['doc_flores']   // Inglés / Ed. Física
  const doc4 = docentes['doc_condori']  // Ciencias Nat. / Sociales
  const docDirector = docentes['director'] // Artes Plásticas
  console.log('✓ 5 docentes (incluye al director dictando Artes Plásticas)')

  const estudianteDatos = [
    { username: 'est_ana',     ci: 'E001', nombre: 'Ana',     apellido: 'Condori Mamani', fechaNacimiento: new Date('2010-03-15'), direccion: 'Av. Pagador 123, Oruro'  },
    { username: 'est_pedro',   ci: 'E002', nombre: 'Pedro',   apellido: 'Huanca Quispe',  fechaNacimiento: new Date('2010-07-22'), direccion: 'Calle Bolívar 45, Oruro' },
    { username: 'est_lucia',   ci: 'E003', nombre: 'Lucía',   apellido: 'Tarqui Flores',  fechaNacimiento: new Date('2009-11-08'), direccion: 'Av. Cívica 78, Oruro'    },
    { username: 'est_miguel',  ci: 'E004', nombre: 'Miguel',  apellido: 'Mamani Choque',  fechaNacimiento: new Date('2010-01-30'), direccion: 'Zona Los Ángeles, Oruro' },
    { username: 'est_valeria', ci: 'E005', nombre: 'Valeria', apellido: 'Quispe Tarqui',  fechaNacimiento: new Date('2009-05-17'), direccion: 'Urb. Bustillos, Oruro'   },
  ]
  const estudiantes: Record<string, { id: number }> = {}
  for (const e of estudianteDatos) {
    const persona = await crearPersona({ ci: e.ci, nombre: e.nombre, apellido: e.apellido, fechaNacimiento: e.fechaNacimiento, direccion: e.direccion })
    estudiantes[e.username] = await prisma.estudiante.upsert({
      where: { personaId: persona.id }, update: {},
      create: { personaId: persona.id, usuarioId: usuarios[e.username].id, activo: true },
    })
  }
  const est1 = estudiantes['est_ana']
  const est2 = estudiantes['est_pedro']
  const est3 = estudiantes['est_lucia']
  const est4 = estudiantes['est_miguel']
  const est5 = estudiantes['est_valeria']
  console.log('✓ 5 estudiantes')

  const tutorDatos = [
    { username: 'tut_rosa',   ci: 'T001', nombre: 'Rosa',   apellido: 'Condori Mamani', telefono: '79001234', email: 'rosa.condori@gmail.com'   },
    { username: 'tut_miguel', ci: 'T002', nombre: 'Miguel', apellido: 'Huanca Torres',  telefono: '79012345', email: 'miguel.huanca@gmail.com'  },
    { username: 'tut_carmen', ci: 'T003', nombre: 'Carmen', apellido: 'Tarqui Flores',  telefono: '79023456', email: 'carmen.tarqui@gmail.com'  },
  ]
  const tutores: Record<string, { id: number }> = {}
  for (const t of tutorDatos) {
    const persona = await crearPersona({ ci: t.ci, nombre: t.nombre, apellido: t.apellido, telefono: t.telefono, email: t.email })
    tutores[t.username] = await prisma.tutor.upsert({
      where: { personaId: persona.id }, update: {},
      create: { personaId: persona.id, usuarioId: usuarios[t.username].id, activo: true },
    })
  }
  const tut1 = tutores['tut_rosa']
  const tut2 = tutores['tut_miguel']
  const tut3 = tutores['tut_carmen']
  console.log('✓ 3 tutores')

  // parentesco ahora vive en TutorEstudiante, no en Tutor
  const vincular = async (tutorId: number, estudianteId: number, parentesco: 'MADRE' | 'PADRE') =>
    prisma.tutorEstudiante.upsert({
      where:  { tutorId_estudianteId: { tutorId, estudianteId } },
      update: {},
      create: { tutorId, estudianteId, parentesco, esTutorPrincipal: true, esApoderado: true, viveConEstudiante: true },
    })
  await vincular(tut1.id, est1.id, 'MADRE')
  await vincular(tut1.id, est4.id, 'MADRE')
  await vincular(tut2.id, est2.id, 'PADRE')
  await vincular(tut3.id, est3.id, 'MADRE')
  await vincular(tut3.id, est5.id, 'MADRE')
  console.log('✓ Vínculos tutor↔estudiante (con parentesco)')

  // ══════════════════════════════════════
  // INSCRIPCIONES
  // ══════════════════════════════════════
  const insc1 = await prisma.inscripcion.upsert({
    where: { estudianteId_gestionId: { estudianteId: est1.id, gestionId: gestion.id } }, update: {},
    create: { estudianteId: est1.id, cursoId: c1A.id, gestionId: gestion.id, estadoInscripcion: 'ACTIVA' },
  })
  const insc2 = await prisma.inscripcion.upsert({
    where: { estudianteId_gestionId: { estudianteId: est2.id, gestionId: gestion.id } }, update: {},
    create: { estudianteId: est2.id, cursoId: c1A.id, gestionId: gestion.id, estadoInscripcion: 'ACTIVA' },
  })
  const insc3 = await prisma.inscripcion.upsert({
    where: { estudianteId_gestionId: { estudianteId: est3.id, gestionId: gestion.id } }, update: {},
    create: { estudianteId: est3.id, cursoId: c1A.id, gestionId: gestion.id, estadoInscripcion: 'ACTIVA' },
  })
  const insc4 = await prisma.inscripcion.upsert({
    where: { estudianteId_gestionId: { estudianteId: est4.id, gestionId: gestion.id } }, update: {},
    create: {
      estudianteId: est4.id, cursoId: c1A.id, gestionId: gestion.id,
      estadoInscripcion: 'RETIRADA',
      fechaRetiro:   new Date('2025-06-15'),
      observaciones: 'Familia se trasladó a otro departamento',
    },
  })
  const insc5 = await prisma.inscripcion.upsert({
    where: { estudianteId_gestionId: { estudianteId: est5.id, gestionId: gestion.id } }, update: {},
    create: { estudianteId: est5.id, cursoId: c1B.id, gestionId: gestion.id, estadoInscripcion: 'ACTIVA' },
  })
  console.log('✓ 5 inscripciones (Miguel: RETIRADA — caso de prueba)')

  // ══════════════════════════════════════
  // ASIGNACIONES DOCENTE-MATERIA-CURSO
  // ══════════════════════════════════════
  const dmc = async (docenteId: number, materiaId: number, cursoId: number) =>
    prisma.docenteMateriaCurso.upsert({
      where:  { docenteId_materiaId_cursoId_gestionId: { docenteId, materiaId, cursoId, gestionId: gestion.id } },
      update: {},
      create: { docenteId, materiaId, cursoId, gestionId: gestion.id },
    })

  const dmc1 = await dmc(doc1.id, mMAT.id, c1A.id)
  const dmc2 = await dmc(doc2.id, mLEN.id, c1A.id)
  const dmc3 = await dmc(doc3.id, mING.id, c1A.id)
  const dmc4 = await dmc(doc3.id, mEFI.id, c1A.id)
  const dmc5 = await dmc(doc4.id, mCNA.id, c1A.id)
  const dmc6 = await dmc(doc4.id, mCSO.id, c1A.id)
  await dmc(docDirector.id, mART.id, c1A.id)
  await dmc(doc1.id, mMAT.id, c1B.id)
  await dmc(doc2.id, mLEN.id, c1B.id)
  await dmc(doc1.id, mMAT.id, c2A.id)
  await dmc(doc2.id, mLEN.id, c2A.id)
  console.log('✓ 11 asignaciones docente-materia-curso')

  // ══════════════════════════════════════
  // ASISTENCIA T1 — Asistencia.trimestreId es directo ahora
  // ══════════════════════════════════════
  const fechas = ['2025-02-03','2025-02-05','2025-02-10','2025-02-12','2025-02-17','2025-02-19','2025-02-24','2025-02-26','2025-03-03','2025-03-05']
  const estadosMat = [
    ['PRESENTE','PRESENTE','PRESENTE','PRESENTE'],
    ['PRESENTE','AUSENTE', 'PRESENTE','PRESENTE'],
    ['PRESENTE','PRESENTE','AUSENTE', 'PRESENTE'],
    ['PRESENTE','PRESENTE','PRESENTE','AUSENTE' ],
    ['PRESENTE','RETRASO', 'PRESENTE','AUSENTE' ],
    ['PRESENTE','PRESENTE','PRESENTE','AUSENTE' ],
    ['PRESENTE','AUSENTE', 'PRESENTE','PRESENTE'],
    ['PRESENTE','PRESENTE','AUSENTE', 'AUSENTE' ],
    ['PRESENTE','PRESENTE','PRESENTE','AUSENTE' ],
    ['PRESENTE','AUSENTE', 'PRESENTE','AUSENTE' ],
  ] as const
  const inscC1A = [insc1, insc2, insc3, insc4]

  for (let d = 0; d < fechas.length; d++) {
    for (let e = 0; e < inscC1A.length; e++) {
      await prisma.asistencia.upsert({
        where:  { inscripcionId_docenteMateriaCursoId_fecha: { inscripcionId: inscC1A[e].id, docenteMateriaCursoId: dmc1.id, fecha: new Date(fechas[d]) } },
        update: {},
        create: { inscripcionId: inscC1A[e].id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, fecha: new Date(fechas[d]), estado: estadosMat[d][e] as any },
      })
    }
  }
  for (const fecha of fechas) {
    for (const insc of inscC1A) {
      await prisma.asistencia.upsert({
        where:  { inscripcionId_docenteMateriaCursoId_fecha: { inscripcionId: insc.id, docenteMateriaCursoId: dmc2.id, fecha: new Date(fecha) } },
        update: {},
        create: { inscripcionId: insc.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, fecha: new Date(fecha), estado: Math.random() > 0.15 ? 'PRESENTE' : 'AUSENTE' },
      })
    }
  }
  console.log('✓ Asistencia T1 (con un caso de RETRASO)')

  // ══════════════════════════════════════
  // ACTIVIDADES EVALUATIVAS + NOTAS (T1, Matemáticas y Lenguaje)
  // Cada estudiante tiene una "fracción de desempeño" (0-1) que se
  // aplica a las 4 dimensiones, para que el promedioTrimestral final
  // salga cerca de esa fracción × 100 — más fácil de verificar a mano.
  // ══════════════════════════════════════
  const actividadesPorDimension = [
    { dimension: dSer,     nombre: 'Autoevaluación de valores', puntajeMaximo: dSer.puntajeMaximo },
    { dimension: dSaber,   nombre: 'Examen escrito',            puntajeMaximo: 100 },
    { dimension: dHacer,   nombre: 'Trabajo práctico',          puntajeMaximo: 100 },
    { dimension: dDecidir, nombre: 'Participación y proyecto',  puntajeMaximo: 100 },
  ]

  async function crearActividadesYNotas(
    dmcId: number, fracciones: Record<number, number> // inscripcionId -> fracción 0-1
  ) {
    for (const a of actividadesPorDimension) {
      // No hay unique natural en ActividadEvaluativa — buscar primero
      // para que el seed sea idempotente (re-ejecutarlo no duplica filas).
      const actividad = await prisma.actividadEvaluativa.findFirst({
        where: { docenteMateriaCursoId: dmcId, trimestreId: trim1.id, dimensionId: a.dimension.id, nombre: a.nombre },
      }) ?? await prisma.actividadEvaluativa.create({
        data: {
          docenteMateriaCursoId: dmcId, trimestreId: trim1.id, dimensionId: a.dimension.id,
          nombre: a.nombre, puntajeMaximo: a.puntajeMaximo, fecha: new Date('2025-04-15'),
        },
      })

      for (const [inscripcionIdStr, fraccion] of Object.entries(fracciones)) {
        const inscripcionId = Number(inscripcionIdStr)
        const nota = Math.round(Number(a.puntajeMaximo) * fraccion * 100) / 100
        await prisma.notaActividad.upsert({
          where:  { actividadEvaluativaId_inscripcionId: { actividadEvaluativaId: actividad.id, inscripcionId } },
          update: { nota },
          create: { actividadEvaluativaId: actividad.id, inscripcionId, nota, registradoPorId: usuarios['doc_mamani'].id },
        })
      }
    }
  }

  const fraccionesMat = { [insc1.id]: 0.78, [insc2.id]: 0.65, [insc3.id]: 0.85, [insc4.id]: 0.45 }
  const fraccionesLen = { [insc1.id]: 0.82, [insc2.id]: 0.58, [insc3.id]: 0.90, [insc4.id]: 0.50 }

  await crearActividadesYNotas(dmc1.id, fraccionesMat)
  await crearActividadesYNotas(dmc2.id, fraccionesLen)
  console.log('✓ Actividades evaluativas + notas (4 dimensiones × 2 materias × 4 estudiantes)')

  // Recalcular Calificacion/CalificacionDimension a partir de las notas
  for (const insc of inscC1A) {
    await recalcularLocal(insc.id, dmc1.id, trim1.id, gestion.id)
    await recalcularLocal(insc.id, dmc2.id, trim1.id, gestion.id)
  }
  console.log('✓ Promedios trimestrales calculados (Calificacion.promedioTrimestral)')

  // ══════════════════════════════════════
  // HISTORIAL DE CALIFICACIONES — corrección manual, solo válida con el
  // trimestre YA cerrado (ver calificacion.controller.ts)
  // ══════════════════════════════════════
  const calMATMiguel = await prisma.calificacion.findUnique({
    where: { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: insc4.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id } },
  })
  if (calMATMiguel) {
    const anterior = calMATMiguel.promedioTrimestral
    await prisma.historialCalificacion.create({
      data: { promedioAnterior: anterior, promedioNuevo: 48, motivo: 'Revisión de prueba de recuperación', usuarioId: usuarios['doc_mamani'].id, calificacionId: calMATMiguel.id },
    })
    await prisma.calificacion.update({ where: { id: calMATMiguel.id }, data: { promedioTrimestral: 48 } })
    await prisma.historialCalificacion.create({
      data: { promedioAnterior: 48, promedioNuevo: 50, motivo: 'Segunda revisión autorizada por director', usuarioId: usuarios['director'].id, calificacionId: calMATMiguel.id },
    })
    await prisma.calificacion.update({ where: { id: calMATMiguel.id }, data: { promedioTrimestral: 50 } })
  }
  console.log('✓ Historial de calificaciones (2 correcciones sobre Miguel — MAT)')

  // ══════════════════════════════════════
  // RESÚMENES DE ASISTENCIA T1
  // ══════════════════════════════════════
  const resumenes = [
    { inscripcionId: insc1.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, totalClases: 10, totalPresente: 10, totalAusente: 0, totalRetraso: 0, totalJustificado: 0, porcentaje: 100 },
    { inscripcionId: insc1.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  9, totalAusente: 1, totalRetraso: 0, totalJustificado: 0, porcentaje:  90 },
    { inscripcionId: insc2.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  5, totalAusente: 4, totalRetraso: 1, totalJustificado: 0, porcentaje:  50 },
    { inscripcionId: insc2.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  8, totalAusente: 2, totalRetraso: 0, totalJustificado: 0, porcentaje:  80 },
    { inscripcionId: insc3.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  9, totalAusente: 1, totalRetraso: 0, totalJustificado: 0, porcentaje:  90 },
    { inscripcionId: insc3.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, totalClases: 10, totalPresente: 10, totalAusente: 0, totalRetraso: 0, totalJustificado: 0, porcentaje: 100 },
    { inscripcionId: insc4.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  4, totalAusente: 6, totalRetraso: 0, totalJustificado: 0, porcentaje:  40 },
    { inscripcionId: insc4.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  7, totalAusente: 3, totalRetraso: 0, totalJustificado: 0, porcentaje:  70 },
  ]
  for (const r of resumenes) {
    await prisma.resumenAsistencia.upsert({
      where:  { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: r.inscripcionId, docenteMateriaCursoId: r.docenteMateriaCursoId, trimestreId: r.trimestreId } },
      update: {},
      create: r,
    })
  }
  console.log('✓ Resúmenes de asistencia T1 (Pedro: 50% en MAT → alerta)')

  // ══════════════════════════════════════
  // CONCEPTOS DE PAGO Y PAGOS
  // ══════════════════════════════════════
  const cp1 = await prisma.conceptoPago.findFirst({ where: { nombre: 'Matrícula 2025', gestionId: gestion.id } })
    ?? await prisma.conceptoPago.create({ data: { nombre: 'Matrícula 2025', descripcion: 'Pago de matrícula gestión 2025.', monto: 150, obligatorio: true, gestionId: gestion.id } })
  const cp2 = await prisma.conceptoPago.findFirst({ where: { nombre: 'Material Didáctico', gestionId: gestion.id } })
    ?? await prisma.conceptoPago.create({ data: { nombre: 'Material Didáctico', descripcion: 'Contribución para material y fotocopias.', monto: 80, obligatorio: true, gestionId: gestion.id } })
  const cp3 = await prisma.conceptoPago.findFirst({ where: { nombre: 'Mantenimiento Infraestructura', gestionId: gestion.id } })
    ?? await prisma.conceptoPago.create({ data: { nombre: 'Mantenimiento Infraestructura', descripcion: 'Contribución voluntaria de mantenimiento.', monto: 50, obligatorio: false, gestionId: gestion.id } })

  const pago = async (inscripcionId: number, conceptoPagoId: number, monto: number, metodo: 'EFECTIVO'|'TRANSFERENCIA'|'QR', recibo: string, estado: 'PAGADO'|'ANULADO' = 'PAGADO') => {
    const existe = await prisma.pago.findUnique({ where: { numeroRecibo: recibo } })
    if (existe) return existe
    return prisma.pago.create({
      data: { inscripcionId, conceptoPagoId, montoOriginal: monto, montoPagado: monto, metodoPago: metodo, estado, numeroRecibo: recibo, registradoPorId: usuarios['secretaria'].id },
    })
  }
  await pago(insc1.id, cp1.id, 150, 'EFECTIVO',      'REC-2025-0001')
  await pago(insc1.id, cp2.id,  80, 'EFECTIVO',      'REC-2025-0002')
  await pago(insc1.id, cp3.id,  50, 'QR',            'REC-2025-0003')
  await pago(insc2.id, cp1.id, 150, 'TRANSFERENCIA', 'REC-2025-0004')
  await pago(insc3.id, cp1.id, 150, 'EFECTIVO',      'REC-2025-0005')
  await pago(insc3.id, cp2.id,  80, 'QR',            'REC-2025-0006')
  await pago(insc4.id, cp1.id, 150, 'EFECTIVO',      'REC-2025-0007', 'ANULADO')
  await pago(insc4.id, cp1.id, 150, 'EFECTIVO',      'REC-2025-0008')
  console.log('✓ Pagos (Valeria: sin pagar — caso de prueba)')

  // ══════════════════════════════════════
  // BITÁCORA DE CLASE (antes "Actividad")
  // ══════════════════════════════════════
  const bitacoras = [
    { fecha: '2025-02-03', tema: 'Números enteros',     descripcion: 'Introducción a operaciones básicas.', tarea: 'Ejercicios pág. 15-16'     },
    { fecha: '2025-02-05', tema: 'Fracciones',          descripcion: 'Operaciones con fracciones propias.', tarea: 'Taller de fracciones'       },
    { fecha: '2025-02-10', tema: 'Decimales',           descripcion: 'Representación y operaciones.',       tarea: 'Ejercicios pág. 22-23'     },
    { fecha: '2025-02-17', tema: 'Porcentajes',         descripcion: 'Cálculo en problemas cotidianos.',    tarea: '10 problemas de aplicación' },
    { fecha: '2025-02-24', tema: 'Álgebra — variables', descripcion: 'Concepto de variable y expresiones.', tarea: 'Pág. 35 — identificar vars' },
  ]
  for (const b of bitacoras) {
    const existe = await prisma.bitacoraClase.findFirst({ where: { docenteMateriaCursoId: dmc1.id, fecha: new Date(b.fecha), tema: b.tema } })
    if (!existe) {
      await prisma.bitacoraClase.create({
        data: { docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, fecha: new Date(b.fecha), tema: b.tema, descripcion: b.descripcion, tareaAsignada: b.tarea },
      })
    }
  }
  console.log('✓ 5 registros de bitácora de clase')

  // ══════════════════════════════════════
  // RESUMEN FINAL
  // ══════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════════')
  console.log('✅ Seed (schema v6) completado exitosamente')
  console.log('════════════════════════════════════════════════════════')
  console.log('\nCREDENCIALES:')
  console.log('┌──────────────┬─────────────┬───────────────────────┬──────────────────────────────┐')
  console.log('│ Usuario      │ Contraseña  │ Roles                 │ Perfil                       │')
  console.log('├──────────────┼─────────────┼───────────────────────┼──────────────────────────────┤')
  console.log('│ director     │ admin1234   │ DIRECTOR, DOCENTE     │ Roberto Vargas (+ Artes Plást)│')
  console.log('│ secretaria   │ sec1234     │ SECRETARIA            │ Carmen Flores Quispe         │')
  console.log('│ doc_mamani   │ doc1234     │ DOCENTE               │ Juan Mamani — MAT 1A/1B/2A  │')
  console.log('│ doc_quispe   │ doc1234     │ DOCENTE               │ María Quispe — LEN           │')
  console.log('│ est_ana      │ est1234     │ ESTUDIANTE            │ Ana Condori — ACTIVA         │')
  console.log('│ est_pedro    │ est1234     │ ESTUDIANTE            │ Pedro Huanca — asist. 50% MAT│')
  console.log('│ est_miguel   │ est1234     │ ESTUDIANTE            │ Miguel Mamani — RETIRADO     │')
  console.log('│ tut_rosa     │ tut1234     │ TUTOR                 │ Rosa Condori (Ana + Miguel)  │')
  console.log('└──────────────┴─────────────┴───────────────────────┴──────────────────────────────┘')
  console.log('\nCASOS DE PRUEBA:')
  console.log('  Pedro   → asistencia MAT 50% → alerta en dashboard/reporte de curso')
  console.log('  Miguel  → RETIRADO 15/06 + 2 correcciones en historial de MAT (48 → 50)')
  console.log('  Valeria → sin ningún pago → estado pendiente')
  console.log('  T1      → cerrado → POST /actividades-evaluativas/:id/notas debe rechazar')
  console.log('            PUT /calificaciones/:id (corrección manual) SÍ debe funcionar')
  console.log('  T2/T3   → abiertos, sin notas → cerrarTrimestre debe rechazar hasta completarlas')
  console.log('  director → login con roles [DIRECTOR, DOCENTE] → probar ambos contextos')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())