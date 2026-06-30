// prisma/seed.ts
// Seed FINAL — incluye Institución, EstadoInscripcion, HistorialCalificacion
// Ejecutar: pnpm db:seed

import bcrypt from 'bcryptjs'
import { PrismaClient } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' })
const prisma  = new PrismaClient({ adapter })

const hash = async (p: string) => bcrypt.hash(p, 12)

async function main() {
  console.log('🌱 Iniciando seed final...\n')

  // ══════════════════════════════════════
  // INSTITUCIÓN
  // ¿Por qué primero? El boletín PDF la necesita
  // para los encabezados dinámicos
  // ══════════════════════════════════════
  await prisma.institucion.upsert({
    where:  { id: 1 },
    update: {},
    create: {
      id:           1,
      nombre:       'Unidad Educativa "Los Ángeles de Nazaria Ignacia"',
      direccion:    'Urbanización Bustillos, Zona Los Ángeles',
      telefono:     '(052) 123456',
      email:        'ue.angeles.nazaria@gmail.com',
      rue:          '81230370',
      municipio:    'Oruro',
      departamento: 'Oruro',
    },
  })
  console.log('✓ Institución configurada')

  // ══════════════════════════════════════
  // GESTIÓN ACTIVA
  // ══════════════════════════════════════
  const gestion = await prisma.gestion.upsert({
    where:  { anio: 2025 },
    update: {},
    create: {
      anio:        2025,
      descripcion: 'Gestión Escolar 2025',
      activa:      true,
      fechaInicio: new Date('2025-02-03'),
      fechaFin:    new Date('2025-11-28'),
    },
  })
  console.log(`✓ Gestión ${gestion.anio}`)

  // ══════════════════════════════════════
  // TRIMESTRES
  // ══════════════════════════════════════
  const [trim1, trim2, trim3] = await Promise.all([
    prisma.trimestre.upsert({
      where:  { numero_gestionId: { numero: 1, gestionId: gestion.id } },
      update: {},
      create: { numero: 1, nombre: 'Primer Trimestre',   gestionId: gestion.id, fechaInicio: new Date('2025-02-03'), fechaFin: new Date('2025-05-02'), cerrado: true  },
    }),
    prisma.trimestre.upsert({
      where:  { numero_gestionId: { numero: 2, gestionId: gestion.id } },
      update: {},
      create: { numero: 2, nombre: 'Segundo Trimestre',  gestionId: gestion.id, fechaInicio: new Date('2025-05-05'), fechaFin: new Date('2025-08-01'), cerrado: false },
    }),
    prisma.trimestre.upsert({
      where:  { numero_gestionId: { numero: 3, gestionId: gestion.id } },
      update: {},
      create: { numero: 3, nombre: 'Tercer Trimestre',   gestionId: gestion.id, fechaInicio: new Date('2025-08-04'), fechaFin: new Date('2025-11-28'), cerrado: false },
    }),
  ])
  console.log('✓ 3 trimestres (T1 cerrado)')

  // ══════════════════════════════════════
  // CURSOS
  // ══════════════════════════════════════
  const [c1A, c1B, c2A] = await Promise.all([
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Primero Secundaria',  paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Primero Secundaria A',  nivel: 'Primero Secundaria',  paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Primero Secundaria',  paralelo: 'B', gestionId: gestion.id } }, update: {}, create: { nombre: 'Primero Secundaria B',  nivel: 'Primero Secundaria',  paralelo: 'B', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Segundo Secundaria',  paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Segundo Secundaria A',  nivel: 'Segundo Secundaria',  paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Tercero Secundaria',  paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Tercero Secundaria A',  nivel: 'Tercero Secundaria',  paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Cuarto Secundaria',   paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Cuarto Secundaria A',   nivel: 'Cuarto Secundaria',   paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Quinto Secundaria',   paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Quinto Secundaria A',   nivel: 'Quinto Secundaria',   paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Sexto Secundaria',    paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Sexto Secundaria A',    nivel: 'Sexto Secundaria',    paralelo: 'A', gestionId: gestion.id } }),
  ])
  console.log('✓ 7 cursos')

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
  // USUARIOS
  // ══════════════════════════════════════
  const uDir  = await prisma.usuario.upsert({ where: { username: 'director'    }, update: {}, create: { username: 'director',    passwordHash: await hash('admin1234'), rol: 'DIRECTOR'   } })
  const uSec  = await prisma.usuario.upsert({ where: { username: 'secretaria'  }, update: {}, create: { username: 'secretaria',  passwordHash: await hash('sec1234'),   rol: 'SECRETARIA' } })
  const uDoc1 = await prisma.usuario.upsert({ where: { username: 'doc_mamani'  }, update: {}, create: { username: 'doc_mamani',  passwordHash: await hash('doc1234'),   rol: 'DOCENTE'    } })
  const uDoc2 = await prisma.usuario.upsert({ where: { username: 'doc_quispe'  }, update: {}, create: { username: 'doc_quispe',  passwordHash: await hash('doc1234'),   rol: 'DOCENTE'    } })
  const uDoc3 = await prisma.usuario.upsert({ where: { username: 'doc_flores'  }, update: {}, create: { username: 'doc_flores',  passwordHash: await hash('doc1234'),   rol: 'DOCENTE'    } })
  const uDoc4 = await prisma.usuario.upsert({ where: { username: 'doc_condori' }, update: {}, create: { username: 'doc_condori', passwordHash: await hash('doc1234'),   rol: 'DOCENTE'    } })
  const uEst1 = await prisma.usuario.upsert({ where: { username: 'est_ana'     }, update: {}, create: { username: 'est_ana',     passwordHash: await hash('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst2 = await prisma.usuario.upsert({ where: { username: 'est_pedro'   }, update: {}, create: { username: 'est_pedro',   passwordHash: await hash('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst3 = await prisma.usuario.upsert({ where: { username: 'est_lucia'   }, update: {}, create: { username: 'est_lucia',   passwordHash: await hash('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst4 = await prisma.usuario.upsert({ where: { username: 'est_miguel'  }, update: {}, create: { username: 'est_miguel',  passwordHash: await hash('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst5 = await prisma.usuario.upsert({ where: { username: 'est_valeria' }, update: {}, create: { username: 'est_valeria', passwordHash: await hash('est1234'),   rol: 'ESTUDIANTE' } })
  const uTut1 = await prisma.usuario.upsert({ where: { username: 'tut_rosa'    }, update: {}, create: { username: 'tut_rosa',    passwordHash: await hash('tut1234'),   rol: 'TUTOR'      } })
  const uTut2 = await prisma.usuario.upsert({ where: { username: 'tut_miguel'  }, update: {}, create: { username: 'tut_miguel',  passwordHash: await hash('tut1234'),   rol: 'TUTOR'      } })
  const uTut3 = await prisma.usuario.upsert({ where: { username: 'tut_carmen'  }, update: {}, create: { username: 'tut_carmen',  passwordHash: await hash('tut1234'),   rol: 'TUTOR'      } })
  console.log('✓ 14 usuarios')

  // ══════════════════════════════════════
  // DIRECTOR + SECRETARIA
  // ══════════════════════════════════════
  const director = await prisma.director.upsert({
    where:  { ci: 'D001' },
    update: {},
    create: {
      ci:        'D001',
      nombre:    'Roberto',
      apellido:  'Vargas Mamani',
      telefono:  '71000001',
      email:     'r.vargas@ue-angeles.edu.bo',
      activo:    true,
      usuarioId: uDir.id,
      gestionId: gestion.id,
    },
  })

  const secretaria = await prisma.secretaria.upsert({
    where:  { ci: 'S001' },
    update: {},
    create: {
      ci:        'S001',
      nombre:    'Carmen',
      apellido:  'Flores Quispe',
      telefono:  '72000001',
      email:     'c.flores@ue-angeles.edu.bo',
      activo:    true,
      usuarioId: uSec.id,
    },
  })
  console.log(`✓ Director: ${director.nombre} ${director.apellido}`)
  console.log(`✓ Secretaria: ${secretaria.nombre} ${secretaria.apellido}`)

  // ══════════════════════════════════════
  // DOCENTES
  // ══════════════════════════════════════
  const doc1 = await prisma.docente.upsert({ where: { ci: '1234567' }, update: {}, create: { ci: '1234567', nombre: 'Juan',   apellido: 'Mamani Condori', especialidad: 'Matemáticas',              telefono: '71234567', email: 'j.mamani@ue-angeles.edu.bo',  activo: true, usuarioId: uDoc1.id } })
  const doc2 = await prisma.docente.upsert({ where: { ci: '2345678' }, update: {}, create: { ci: '2345678', nombre: 'María',  apellido: 'Quispe Tarqui',  especialidad: 'Lenguaje y Literatura',    telefono: '72345678', email: 'm.quispe@ue-angeles.edu.bo',  activo: true, usuarioId: uDoc2.id } })
  const doc3 = await prisma.docente.upsert({ where: { ci: '3456789' }, update: {}, create: { ci: '3456789', nombre: 'Carlos', apellido: 'Flores Huanca',  especialidad: 'Inglés y Ed. Física',     telefono: '73456789', email: 'c.flores@ue-angeles.edu.bo',  activo: true, usuarioId: uDoc3.id } })
  const doc4 = await prisma.docente.upsert({ where: { ci: '4567890' }, update: {}, create: { ci: '4567890', nombre: 'Sofía',  apellido: 'Condori Mamani', especialidad: 'Ciencias Nat. y Sociales', telefono: '74567890', email: 's.condori@ue-angeles.edu.bo', activo: true, usuarioId: uDoc4.id } })
  console.log('✓ 4 docentes')

  // ══════════════════════════════════════
  // ESTUDIANTES
  // ══════════════════════════════════════
  const est1 = await prisma.estudiante.upsert({ where: { ci: 'E001' }, update: {}, create: { ci: 'E001', nombre: 'Ana',     apellido: 'Condori Mamani', fechaNacimiento: new Date('2010-03-15'), direccion: 'Av. Pagador 123, Oruro',  activo: true, usuarioId: uEst1.id } })
  const est2 = await prisma.estudiante.upsert({ where: { ci: 'E002' }, update: {}, create: { ci: 'E002', nombre: 'Pedro',   apellido: 'Huanca Quispe',  fechaNacimiento: new Date('2010-07-22'), direccion: 'Calle Bolívar 45, Oruro', activo: true, usuarioId: uEst2.id } })
  const est3 = await prisma.estudiante.upsert({ where: { ci: 'E003' }, update: {}, create: { ci: 'E003', nombre: 'Lucía',   apellido: 'Tarqui Flores',  fechaNacimiento: new Date('2009-11-08'), direccion: 'Av. Cívica 78, Oruro',   activo: true, usuarioId: uEst3.id } })
  const est4 = await prisma.estudiante.upsert({ where: { ci: 'E004' }, update: {}, create: { ci: 'E004', nombre: 'Miguel',  apellido: 'Mamani Choque',  fechaNacimiento: new Date('2010-01-30'), direccion: 'Zona Los Ángeles, Oruro', activo: true, usuarioId: uEst4.id } })
  const est5 = await prisma.estudiante.upsert({ where: { ci: 'E005' }, update: {}, create: { ci: 'E005', nombre: 'Valeria', apellido: 'Quispe Tarqui',  fechaNacimiento: new Date('2009-05-17'), direccion: 'Urb. Bustillos, Oruro',  activo: true, usuarioId: uEst5.id } })
  console.log('✓ 5 estudiantes')

  // ══════════════════════════════════════
  // TUTORES
  // ══════════════════════════════════════
  const tut1 = await prisma.tutor.upsert({ where: { ci: 'T001' }, update: {}, create: { ci: 'T001', nombre: 'Rosa',   apellido: 'Condori Mamani', telefono: '79001234', email: 'rosa.condori@gmail.com',  parentesco: 'Madre', usuarioId: uTut1.id } })
  const tut2 = await prisma.tutor.upsert({ where: { ci: 'T002' }, update: {}, create: { ci: 'T002', nombre: 'Miguel', apellido: 'Huanca Torres',  telefono: '79012345', email: 'miguel.huanca@gmail.com', parentesco: 'Padre', usuarioId: uTut2.id } })
  const tut3 = await prisma.tutor.upsert({ where: { ci: 'T003' }, update: {}, create: { ci: 'T003', nombre: 'Carmen', apellido: 'Tarqui Flores',  telefono: '79023456', email: 'carmen.tarqui@gmail.com', parentesco: 'Madre', usuarioId: uTut3.id } })
  console.log('✓ 3 tutores')

  // Vínculos tutor ↔ estudiante
  const vincular = async (tutorId: number, estudianteId: number) =>
    prisma.tutorEstudiante.upsert({
      where:  { tutorId_estudianteId: { tutorId, estudianteId } },
      update: {},
      create: { tutorId, estudianteId },
    })
  await vincular(tut1.id, est1.id)  // Rosa → Ana
  await vincular(tut1.id, est4.id)  // Rosa → Miguel
  await vincular(tut2.id, est2.id)  // Miguel → Pedro
  await vincular(tut3.id, est3.id)  // Carmen → Lucía
  await vincular(tut3.id, est5.id)  // Carmen → Valeria
  console.log('✓ Vínculos tutor↔estudiante')

  // ══════════════════════════════════════
  // INSCRIPCIONES
  // Incluye estadoInscripcion — nuevo campo
  // ══════════════════════════════════════
  const insc1 = await prisma.inscripcion.upsert({
    where:  { estudianteId_gestionId: { estudianteId: est1.id, gestionId: gestion.id } },
    update: {},
    create: { estudianteId: est1.id, cursoId: c1A.id, gestionId: gestion.id, estadoInscripcion: 'ACTIVA' },
  })
  const insc2 = await prisma.inscripcion.upsert({
    where:  { estudianteId_gestionId: { estudianteId: est2.id, gestionId: gestion.id } },
    update: {},
    create: { estudianteId: est2.id, cursoId: c1A.id, gestionId: gestion.id, estadoInscripcion: 'ACTIVA' },
  })
  const insc3 = await prisma.inscripcion.upsert({
    where:  { estudianteId_gestionId: { estudianteId: est3.id, gestionId: gestion.id } },
    update: {},
    create: { estudianteId: est3.id, cursoId: c1A.id, gestionId: gestion.id, estadoInscripcion: 'ACTIVA' },
  })
  const insc4 = await prisma.inscripcion.upsert({
    where:  { estudianteId_gestionId: { estudianteId: est4.id, gestionId: gestion.id } },
    update: {},
    // Miguel está RETIRADO — caso de prueba para EstadoInscripcion
    create: {
      estudianteId:     est4.id,
      cursoId:          c1A.id,
      gestionId:        gestion.id,
      estadoInscripcion: 'RETIRADA',
      fechaRetiro:      new Date('2025-06-15'),
      observaciones:    'Familia se trasladó a otro departamento',
    },
  })
  const insc5 = await prisma.inscripcion.upsert({
    where:  { estudianteId_gestionId: { estudianteId: est5.id, gestionId: gestion.id } },
    update: {},
    create: { estudianteId: est5.id, cursoId: c1B.id, gestionId: gestion.id, estadoInscripcion: 'ACTIVA' },
  })
  console.log('✓ 5 inscripciones (Miguel: RETIRADA el 15/06 — caso de prueba)')

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
  await dmc(doc1.id, mMAT.id, c1B.id)
  await dmc(doc2.id, mLEN.id, c1B.id)
  await dmc(doc1.id, mMAT.id, c2A.id)
  await dmc(doc2.id, mLEN.id, c2A.id)
  console.log('✓ 10 asignaciones docente-materia-curso')

  // ══════════════════════════════════════
  // ASISTENCIA T1
  // ══════════════════════════════════════
  const fechas = [
    '2025-02-03','2025-02-05','2025-02-10','2025-02-12','2025-02-17',
    '2025-02-19','2025-02-24','2025-02-26','2025-03-03','2025-03-05',
  ]
  const estadosMat = [
    ['PRESENTE','PRESENTE','PRESENTE','PRESENTE'],
    ['PRESENTE','AUSENTE', 'PRESENTE','PRESENTE'],
    ['PRESENTE','PRESENTE','AUSENTE', 'PRESENTE'],
    ['PRESENTE','PRESENTE','PRESENTE','AUSENTE' ],
    ['PRESENTE','AUSENTE', 'PRESENTE','AUSENTE' ],
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
        where: { inscripcionId_docenteMateriaCursoId_fecha: { inscripcionId: inscC1A[e].id, docenteMateriaCursoId: dmc1.id, fecha: new Date(fechas[d]) } },
        update: {},
        create: { inscripcionId: inscC1A[e].id, docenteMateriaCursoId: dmc1.id, fecha: new Date(fechas[d]), estado: estadosMat[d][e] as any },
      })
    }
  }
  for (const fecha of fechas) {
    for (const insc of inscC1A) {
      await prisma.asistencia.upsert({
        where: { inscripcionId_docenteMateriaCursoId_fecha: { inscripcionId: insc.id, docenteMateriaCursoId: dmc2.id, fecha: new Date(fecha) } },
        update: {},
        create: { inscripcionId: insc.id, docenteMateriaCursoId: dmc2.id, fecha: new Date(fecha), estado: Math.random() > 0.15 ? 'PRESENTE' : 'AUSENTE' },
      })
    }
  }
  console.log('✓ Asistencia T1')

  // ══════════════════════════════════════
  // CALIFICACIONES T1 (cerrado)
  // ══════════════════════════════════════
  const notas: Record<number, Record<string, number>> = {
    [insc1.id]: { mat: 78, len: 82, cna: 75, cso: 80, ing: 70, efi: 90 },
    [insc2.id]: { mat: 65, len: 58, cna: 62, cso: 70, ing: 55, efi: 85 },
    [insc3.id]: { mat: 85, len: 90, cna: 88, cso: 82, ing: 78, efi: 92 },
    [insc4.id]: { mat: 45, len: 50, cna: 48, cso: 55, ing: 40, efi: 75 },
  }
  const dmcMap = [
    { d: dmc1, k: 'mat' }, { d: dmc2, k: 'len' },
    { d: dmc5, k: 'cna' }, { d: dmc6, k: 'cso' },
    { d: dmc3, k: 'ing' }, { d: dmc4, k: 'efi' },
  ]

  const calificacionesCreadas: Array<{ id: number; inscripcionId: number; nota: number; dmcId: number }> = []

  for (const insc of inscC1A) {
    for (const { d, k } of dmcMap) {
      const nota = notas[insc.id][k]
      const cal = await prisma.calificacion.upsert({
        where: { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trim1.id } },
        update: {},
        create: { inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trim1.id, nota, promedioTrimestral: nota },
      })
      calificacionesCreadas.push({ id: cal.id, inscripcionId: insc.id, nota, dmcId: d.id })

      await prisma.promedioFinal.upsert({
        where: { inscripcionId_docenteMateriaCursoId: { inscripcionId: insc.id, docenteMateriaCursoId: d.id } },
        update: {},
        create: { inscripcionId: insc.id, docenteMateriaCursoId: d.id, promedioFinal: nota, aprobado: nota >= 51 },
      })
    }
  }
  console.log('✓ Calificaciones T1')

  // ══════════════════════════════════════
  // HISTORIAL DE CALIFICACIONES
  // ¿Por qué? Para probar que el sistema registra
  // los cambios de notas con trazabilidad completa
  // Simula que el docente Mamani corrigió 2 notas
  // ══════════════════════════════════════
  const calMATPedro = calificacionesCreadas.find(
    c => c.inscripcionId === insc2.id && c.dmcId === dmc1.id
  )
  const calMATMiguel = calificacionesCreadas.find(
    c => c.inscripcionId === insc4.id && c.dmcId === dmc1.id
  )

  if (calMATPedro) {
    await prisma.historialCalificacion.create({
      data: {
        notaAnterior:   55,    // nota original antes de la corrección
        notaNueva:      65,    // nota actual en la BD
        motivo:         'Error de transcripción — revisado con examen físico',
        usuarioId:      uDoc1.id,  // doc_mamani hizo el cambio
        calificacionId: calMATPedro.id,
      },
    })
  }

  if (calMATMiguel) {
    // Miguel tuvo dos cambios de nota
    await prisma.historialCalificacion.create({
      data: {
        notaAnterior:   35,
        notaNueva:      40,
        motivo:         'Revisión de prueba de recuperación',
        usuarioId:      uDoc1.id,
        calificacionId: calMATMiguel.id,
      },
    })
    await prisma.historialCalificacion.create({
      data: {
        notaAnterior:   40,
        notaNueva:      45,   // nota actual
        motivo:         'Segunda revisión autorizada por director',
        usuarioId:      uDir.id,  // el director también intervino
        calificacionId: calMATMiguel.id,
      },
    })
  }
  console.log('✓ Historial de calificaciones (Pedro: 1 cambio, Miguel: 2 cambios)')

  // ══════════════════════════════════════
  // RESÚMENES DE ASISTENCIA T1
  // ══════════════════════════════════════
  const resumenes = [
    { inscripcionId: insc1.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, totalClases: 10, totalPresente: 10, totalAusente: 0, totalJustificado: 0, porcentaje: 100 },
    { inscripcionId: insc1.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  9, totalAusente: 1, totalJustificado: 0, porcentaje:  90 },
    { inscripcionId: insc2.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  6, totalAusente: 4, totalJustificado: 0, porcentaje:  60 },
    { inscripcionId: insc2.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  8, totalAusente: 2, totalJustificado: 0, porcentaje:  80 },
    { inscripcionId: insc3.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  9, totalAusente: 1, totalJustificado: 0, porcentaje:  90 },
    { inscripcionId: insc3.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, totalClases: 10, totalPresente: 10, totalAusente: 0, totalJustificado: 0, porcentaje: 100 },
    { inscripcionId: insc4.id, docenteMateriaCursoId: dmc1.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  4, totalAusente: 6, totalJustificado: 0, porcentaje:  40 },
    { inscripcionId: insc4.id, docenteMateriaCursoId: dmc2.id, trimestreId: trim1.id, totalClases: 10, totalPresente:  7, totalAusente: 3, totalJustificado: 0, porcentaje:  70 },
  ]
  for (const r of resumenes) {
    await prisma.resumenAsistencia.upsert({
      where: { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: r.inscripcionId, docenteMateriaCursoId: r.docenteMateriaCursoId, trimestreId: r.trimestreId } },
      update: {},
      create: r,
    })
  }
  console.log('✓ Resúmenes de asistencia T1')

  // ══════════════════════════════════════
  // CONCEPTOS DE PAGO Y PAGOS
  // ══════════════════════════════════════
  const cp1 = await prisma.conceptoPago.create({ data: { nombre: 'Matrícula 2025',              descripcion: 'Pago de matrícula gestión 2025.',             monto: 150, obligatorio: true,  gestionId: gestion.id } }).catch(async () => (await prisma.conceptoPago.findFirst({ where: { nombre: 'Matrícula 2025',              gestionId: gestion.id } }))!)
  const cp2 = await prisma.conceptoPago.create({ data: { nombre: 'Material Didáctico',           descripcion: 'Contribución para material y fotocopias.',    monto:  80, obligatorio: true,  gestionId: gestion.id } }).catch(async () => (await prisma.conceptoPago.findFirst({ where: { nombre: 'Material Didáctico',           gestionId: gestion.id } }))!)
  const cp3 = await prisma.conceptoPago.create({ data: { nombre: 'Mantenimiento Infraestructura', descripcion: 'Contribución voluntaria de mantenimiento.',  monto:  50, obligatorio: false, gestionId: gestion.id } }).catch(async () => (await prisma.conceptoPago.findFirst({ where: { nombre: 'Mantenimiento Infraestructura', gestionId: gestion.id } }))!)

  const pago = async (inscripcionId: number, conceptoPagoId: number, monto: number, metodo: 'EFECTIVO'|'TRANSFERENCIA'|'QR', recibo: string, estado: 'PAGADO'|'ANULADO' = 'PAGADO') => {
    try {
      return await prisma.pago.create({ data: { inscripcionId, conceptoPagoId, montoPagado: monto, metodoPago: metodo, estado, numeroRecibo: recibo, registradoPorId: uSec.id } })
    } catch { return null }
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
  // ACTIVIDADES
  // ══════════════════════════════════════
  const acts = [
    { fecha: '2025-02-03', tema: 'Números enteros',   descripcion: 'Introducción a operaciones básicas.',   tarea: 'Ejercicios pág. 15-16'     },
    { fecha: '2025-02-05', tema: 'Fracciones',        descripcion: 'Operaciones con fracciones propias.',   tarea: 'Taller de fracciones'       },
    { fecha: '2025-02-10', tema: 'Decimales',         descripcion: 'Representación y operaciones.',         tarea: 'Ejercicios pág. 22-23'     },
    { fecha: '2025-02-17', tema: 'Porcentajes',       descripcion: 'Cálculo en problemas cotidianos.',      tarea: '10 problemas de aplicación' },
    { fecha: '2025-02-24', tema: 'Álgebra — variables', descripcion: 'Concepto de variable y expresiones.', tarea: 'Pág. 35 — identificar vars' },
  ]
  for (const a of acts) {
    try {
      await prisma.actividad.create({ data: { docenteMateriaCursoId: dmc1.id, fecha: new Date(a.fecha), tema: a.tema, descripcion: a.descripcion, tareaAsignada: a.tarea } })
    } catch { /* ignora duplicados */ }
  }
  console.log('✓ 5 actividades')

  // ══════════════════════════════════════
  // RESUMEN FINAL
  // ══════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════════')
  console.log('✅ Seed FINAL completado exitosamente')
  console.log('════════════════════════════════════════════════════════')
  console.log('\nCREDENCIALES:')
  console.log('┌──────────────┬─────────────┬─────────────┬──────────────────────────┐')
  console.log('│ Usuario      │ Contraseña  │ Rol         │ Perfil                   │')
  console.log('├──────────────┼─────────────┼─────────────┼──────────────────────────┤')
  console.log('│ director     │ admin1234   │ DIRECTOR    │ Roberto Vargas Mamani    │')
  console.log('│ secretaria   │ sec1234     │ SECRETARIA  │ Carmen Flores Quispe     │')
  console.log('│ doc_mamani   │ doc1234     │ DOCENTE     │ Juan Mamani Condori      │')
  console.log('│ doc_quispe   │ doc1234     │ DOCENTE     │ María Quispe Tarqui      │')
  console.log('│ doc_flores   │ doc1234     │ DOCENTE     │ Carlos Flores Huanca     │')
  console.log('│ doc_condori  │ doc1234     │ DOCENTE     │ Sofía Condori Mamani     │')
  console.log('│ est_ana      │ est1234     │ ESTUDIANTE  │ Ana Condori — ACTIVA     │')
  console.log('│ est_pedro    │ est1234     │ ESTUDIANTE  │ Pedro Huanca — ACTIVA    │')
  console.log('│ est_lucia    │ est1234     │ ESTUDIANTE  │ Lucía Tarqui — ACTIVA    │')
  console.log('│ est_miguel   │ est1234     │ ESTUDIANTE  │ Miguel Mamani — RETIRADA │')
  console.log('│ est_valeria  │ est1234     │ ESTUDIANTE  │ Valeria Quispe — ACTIVA  │')
  console.log('│ tut_rosa     │ tut1234     │ TUTOR       │ Rosa → Ana + Miguel      │')
  console.log('│ tut_miguel   │ tut1234     │ TUTOR       │ Miguel → Pedro           │')
  console.log('│ tut_carmen   │ tut1234     │ TUTOR       │ Carmen → Lucía + Valeria │')
  console.log('└──────────────┴─────────────┴─────────────┴──────────────────────────┘')
  console.log('\nCASOS DE PRUEBA:')
  console.log('  Institución  → GET /api/institucion → datos del colegio dinámicos')
  console.log('  Pedro MAT    → asistencia 60% → alerta en dashboard')
  console.log('  Miguel MAT   → asistencia 40% + notas < 51 → RETIRADO el 15/06')
  console.log('  Miguel notas → 2 cambios en historial (docente + director)')
  console.log('  Pedro notas  → 1 cambio en historial (docente)')
  console.log('  Valeria      → sin ningún pago → estado pendiente')
  console.log('  T1           → cerrado → editar notas retorna 403')
  console.log('  Boletín PDF  → encabezado toma datos de tabla Institucion')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())