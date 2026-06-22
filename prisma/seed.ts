// prisma/seed.ts
// Seed completo — Sistema Web U.E. "Los Ángeles de Nazaria Ignacia"
// Ejecutar: pnpm db:seed

import bcrypt from 'bcryptjs'
import { EstadoAsistencia, PrismaClient } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' })
const prisma  = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Iniciando seed...\n')

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
  const trimestres = await Promise.all([
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
  console.log(`✓ ${trimestres.length} trimestres (T1 cerrado, T2 y T3 abiertos)`)

  // ══════════════════════════════════════
  // CURSOS
  // ══════════════════════════════════════
  const cursos = await Promise.all([
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Primero Secundaria',   paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Primero Secundaria A',   nivel: 'Primero Secundaria',   paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Primero Secundaria',   paralelo: 'B', gestionId: gestion.id } }, update: {}, create: { nombre: 'Primero Secundaria B',   nivel: 'Primero Secundaria',   paralelo: 'B', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Segundo Secundaria',   paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Segundo Secundaria A',   nivel: 'Segundo Secundaria',   paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Tercero Secundaria',   paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Tercero Secundaria A',   nivel: 'Tercero Secundaria',   paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Cuarto Secundaria',    paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Cuarto Secundaria A',    nivel: 'Cuarto Secundaria',    paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Quinto Secundaria',    paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Quinto Secundaria A',    nivel: 'Quinto Secundaria',    paralelo: 'A', gestionId: gestion.id } }),
    prisma.curso.upsert({ where: { nivel_paralelo_gestionId: { nivel: 'Sexto Secundaria',     paralelo: 'A', gestionId: gestion.id } }, update: {}, create: { nombre: 'Sexto Secundaria A',     nivel: 'Sexto Secundaria',     paralelo: 'A', gestionId: gestion.id } }),
  ])
  console.log(`✓ ${cursos.length} cursos`)

  const [c1A, c1B, c2A] = cursos

  // ══════════════════════════════════════
  // MATERIAS
  // ══════════════════════════════════════
  const materias = await Promise.all([
    prisma.materia.upsert({ where: { codigo: 'MAT' }, update: {}, create: { nombre: 'Matemáticas',              codigo: 'MAT', horasSemanales: 5 } }),
    prisma.materia.upsert({ where: { codigo: 'LEN' }, update: {}, create: { nombre: 'Lenguaje',                 codigo: 'LEN', horasSemanales: 5 } }),
    prisma.materia.upsert({ where: { codigo: 'CNA' }, update: {}, create: { nombre: 'Ciencias Naturales',       codigo: 'CNA', horasSemanales: 4 } }),
    prisma.materia.upsert({ where: { codigo: 'CSO' }, update: {}, create: { nombre: 'Ciencias Sociales',        codigo: 'CSO', horasSemanales: 4 } }),
    prisma.materia.upsert({ where: { codigo: 'ING' }, update: {}, create: { nombre: 'Inglés',                   codigo: 'ING', horasSemanales: 3 } }),
    prisma.materia.upsert({ where: { codigo: 'EFI' }, update: {}, create: { nombre: 'Educación Física',         codigo: 'EFI', horasSemanales: 3 } }),
    prisma.materia.upsert({ where: { codigo: 'ART' }, update: {}, create: { nombre: 'Artes Plásticas',          codigo: 'ART', horasSemanales: 2 } }),
    prisma.materia.upsert({ where: { codigo: 'TEC' }, update: {}, create: { nombre: 'Técnica Tecnológica',      codigo: 'TEC', horasSemanales: 3 } }),
    prisma.materia.upsert({ where: { codigo: 'VAL' }, update: {}, create: { nombre: 'Valores, Espiritualidad y Religiones', codigo: 'VAL', horasSemanales: 2 } }),
    prisma.materia.upsert({ where: { codigo: 'COM' }, update: {}, create: { nombre: 'Cosmovisiones y Filosofía',codigo: 'COM', horasSemanales: 3 } }),
  ])
  console.log(`✓ ${materias.length} materias`)

  const [mMAT, mLEN, mCNA, mCSO, mING, mEFI] = materias

  // ══════════════════════════════════════
  // USUARIOS
  // ══════════════════════════════════════
  const hashPass = async (p: string) => bcrypt.hash(p, 12)

  const uDir  = await prisma.usuario.upsert({ where: { username: 'director'    }, update: {}, create: { username: 'director',    passwordHash: await hashPass('admin1234'), rol: 'DIRECTOR'   } })
  const uSec  = await prisma.usuario.upsert({ where: { username: 'secretaria'  }, update: {}, create: { username: 'secretaria',  passwordHash: await hashPass('sec1234'),   rol: 'SECRETARIA' } })
  const uDoc1 = await prisma.usuario.upsert({ where: { username: 'doc_mamani'  }, update: {}, create: { username: 'doc_mamani',  passwordHash: await hashPass('doc1234'),   rol: 'DOCENTE'    } })
  const uDoc2 = await prisma.usuario.upsert({ where: { username: 'doc_quispe'  }, update: {}, create: { username: 'doc_quispe',  passwordHash: await hashPass('doc1234'),   rol: 'DOCENTE'    } })
  const uDoc3 = await prisma.usuario.upsert({ where: { username: 'doc_flores'  }, update: {}, create: { username: 'doc_flores',  passwordHash: await hashPass('doc1234'),   rol: 'DOCENTE'    } })
  const uDoc4 = await prisma.usuario.upsert({ where: { username: 'doc_condori' }, update: {}, create: { username: 'doc_condori', passwordHash: await hashPass('doc1234'),   rol: 'DOCENTE'    } })

  const uEst1 = await prisma.usuario.upsert({ where: { username: 'est_ana'     }, update: {}, create: { username: 'est_ana',     passwordHash: await hashPass('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst2 = await prisma.usuario.upsert({ where: { username: 'est_pedro'   }, update: {}, create: { username: 'est_pedro',   passwordHash: await hashPass('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst3 = await prisma.usuario.upsert({ where: { username: 'est_lucia'   }, update: {}, create: { username: 'est_lucia',   passwordHash: await hashPass('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst4 = await prisma.usuario.upsert({ where: { username: 'est_miguel'  }, update: {}, create: { username: 'est_miguel',  passwordHash: await hashPass('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst5 = await prisma.usuario.upsert({ where: { username: 'est_valeria' }, update: {}, create: { username: 'est_valeria', passwordHash: await hashPass('est1234'),   rol: 'ESTUDIANTE' } })
  const uEst6 = await prisma.usuario.upsert({ where: { username: 'est_carlos'  }, update: {}, create: { username: 'est_carlos',  passwordHash: await hashPass('est1234'),   rol: 'ESTUDIANTE' } })

  const uTut1 = await prisma.usuario.upsert({ where: { username: 'tut_rosa'    }, update: {}, create: { username: 'tut_rosa',    passwordHash: await hashPass('tut1234'),   rol: 'TUTOR'      } })
  const uTut2 = await prisma.usuario.upsert({ where: { username: 'tut_miguel'  }, update: {}, create: { username: 'tut_miguel',  passwordHash: await hashPass('tut1234'),   rol: 'TUTOR'      } })
  const uTut3 = await prisma.usuario.upsert({ where: { username: 'tut_carmen'  }, update: {}, create: { username: 'tut_carmen',  passwordHash: await hashPass('tut1234'),   rol: 'TUTOR'      } })

  console.log('✓ 14 usuarios creados')

  // ══════════════════════════════════════
  // DOCENTES
  // ══════════════════════════════════════
  const doc1 = await prisma.docente.upsert({ where: { ci: '1234567' }, update: {}, create: { ci: '1234567', nombre: 'Juan',    apellido: 'Mamani',  especialidad: 'Matemáticas',         telefono: '71234567', email: 'j.mamani@ue.edu.bo',  activo: true, usuarioId: uDoc1.id } })
  const doc2 = await prisma.docente.upsert({ where: { ci: '2345678' }, update: {}, create: { ci: '2345678', nombre: 'María',   apellido: 'Quispe',  especialidad: 'Lenguaje y Literatura', telefono: '72345678', email: 'm.quispe@ue.edu.bo',  activo: true, usuarioId: uDoc2.id } })
  const doc3 = await prisma.docente.upsert({ where: { ci: '3456789' }, update: {}, create: { ci: '3456789', nombre: 'Carlos',  apellido: 'Flores',  especialidad: 'Inglés y Ed. Física',  telefono: '73456789', email: 'c.flores@ue.edu.bo',  activo: true, usuarioId: uDoc3.id } })
  const doc4 = await prisma.docente.upsert({ where: { ci: '4567890' }, update: {}, create: { ci: '4567890', nombre: 'Sofía',   apellido: 'Condori', especialidad: 'Ciencias Naturales y Sociales', telefono: '74567890', email: 's.condori@ue.edu.bo', activo: true, usuarioId: uDoc4.id } })
  console.log('✓ 4 docentes')

  // ══════════════════════════════════════
  // ESTUDIANTES
  // ══════════════════════════════════════
  const est1 = await prisma.estudiante.upsert({ where: { ci: 'E001' }, update: {}, create: { ci: 'E001', nombre: 'Ana',     apellido: 'Condori Mamani', fechaNacimiento: new Date('2010-03-15'), direccion: 'Av. Pagador 123, Oruro',   activo: true, usuarioId: uEst1.id } })
  const est2 = await prisma.estudiante.upsert({ where: { ci: 'E002' }, update: {}, create: { ci: 'E002', nombre: 'Pedro',   apellido: 'Huanca Quispe',  fechaNacimiento: new Date('2010-07-22'), direccion: 'Calle Bolívar 45, Oruro',  activo: true, usuarioId: uEst2.id } })
  const est3 = await prisma.estudiante.upsert({ where: { ci: 'E003' }, update: {}, create: { ci: 'E003', nombre: 'Lucía',   apellido: 'Tarqui Flores',  fechaNacimiento: new Date('2009-11-08'), direccion: 'Av. Civica 78, Oruro',    activo: true, usuarioId: uEst3.id } })
  const est4 = await prisma.estudiante.upsert({ where: { ci: 'E004' }, update: {}, create: { ci: 'E004', nombre: 'Miguel',  apellido: 'Mamani Choque',  fechaNacimiento: new Date('2010-01-30'), direccion: 'Zona Los Ángeles, Oruro', activo: true, usuarioId: uEst4.id } })
  const est5 = await prisma.estudiante.upsert({ where: { ci: 'E005' }, update: {}, create: { ci: 'E005', nombre: 'Valeria', apellido: 'Quispe Tarqui',  fechaNacimiento: new Date('2009-05-17'), direccion: 'Urb. Bustillos, Oruro',   activo: true, usuarioId: uEst5.id } })
  const est6 = await prisma.estudiante.upsert({ where: { ci: 'E006' }, update: {}, create: { ci: 'E006', nombre: 'Carlos',  apellido: 'Flores Condori', fechaNacimiento: new Date('2010-09-03'), direccion: 'Av. Brasil 90, Oruro',    activo: true, usuarioId: uEst6.id } })
  console.log('✓ 6 estudiantes')

  // ══════════════════════════════════════
  // TUTORES
  // ══════════════════════════════════════
  const tut1 = await prisma.tutor.upsert({ where: { ci: 'T001' }, update: {}, create: { ci: 'T001', nombre: 'Rosa',    apellido: 'Condori Mamani', telefono: '79001234', email: 'rosa.condori@gmail.com',  parentesco: 'Madre', usuarioId: uTut1.id } })
  const tut2 = await prisma.tutor.upsert({ where: { ci: 'T002' }, update: {}, create: { ci: 'T002', nombre: 'Miguel',  apellido: 'Huanca Torres',  telefono: '79012345', email: 'miguel.huanca@gmail.com', parentesco: 'Padre', usuarioId: uTut2.id } })
  const tut3 = await prisma.tutor.upsert({ where: { ci: 'T003' }, update: {}, create: { ci: 'T003', nombre: 'Carmen',  apellido: 'Tarqui Flores',  telefono: '79023456', email: 'carmen.tarqui@gmail.com', parentesco: 'Madre', usuarioId: uTut3.id } })
  console.log('✓ 3 tutores')

  // Vínculos tutor-estudiante
  await prisma.tutorEstudiante.upsert({ where: { tutorId_estudianteId: { tutorId: tut1.id, estudianteId: est1.id } }, update: {}, create: { tutorId: tut1.id, estudianteId: est1.id } })
  await prisma.tutorEstudiante.upsert({ where: { tutorId_estudianteId: { tutorId: tut1.id, estudianteId: est4.id } }, update: {}, create: { tutorId: tut1.id, estudianteId: est4.id } })
  await prisma.tutorEstudiante.upsert({ where: { tutorId_estudianteId: { tutorId: tut2.id, estudianteId: est2.id } }, update: {}, create: { tutorId: tut2.id, estudianteId: est2.id } })
  await prisma.tutorEstudiante.upsert({ where: { tutorId_estudianteId: { tutorId: tut3.id, estudianteId: est3.id } }, update: {}, create: { tutorId: tut3.id, estudianteId: est3.id } })
  await prisma.tutorEstudiante.upsert({ where: { tutorId_estudianteId: { tutorId: tut3.id, estudianteId: est5.id } }, update: {}, create: { tutorId: tut3.id, estudianteId: est5.id } })
  console.log('✓ Vínculos tutor↔estudiante')

  // ══════════════════════════════════════
  // INSCRIPCIONES
  // ══════════════════════════════════════
  const insc1 = await prisma.inscripcion.upsert({ where: { estudianteId_gestionId: { estudianteId: est1.id, gestionId: gestion.id } }, update: {}, create: { estudianteId: est1.id, cursoId: c1A.id, gestionId: gestion.id } })
  const insc2 = await prisma.inscripcion.upsert({ where: { estudianteId_gestionId: { estudianteId: est2.id, gestionId: gestion.id } }, update: {}, create: { estudianteId: est2.id, cursoId: c1A.id, gestionId: gestion.id } })
  const insc3 = await prisma.inscripcion.upsert({ where: { estudianteId_gestionId: { estudianteId: est3.id, gestionId: gestion.id } }, update: {}, create: { estudianteId: est3.id, cursoId: c1A.id, gestionId: gestion.id } })
  const insc4 = await prisma.inscripcion.upsert({ where: { estudianteId_gestionId: { estudianteId: est4.id, gestionId: gestion.id } }, update: {}, create: { estudianteId: est4.id, cursoId: c1A.id, gestionId: gestion.id } })
  const insc5 = await prisma.inscripcion.upsert({ where: { estudianteId_gestionId: { estudianteId: est5.id, gestionId: gestion.id } }, update: {}, create: { estudianteId: est5.id, cursoId: c1B.id, gestionId: gestion.id } })
  const insc6 = await prisma.inscripcion.upsert({ where: { estudianteId_gestionId: { estudianteId: est6.id, gestionId: gestion.id } }, update: {}, create: { estudianteId: est6.id, cursoId: c2A.id, gestionId: gestion.id } })
  console.log('✓ 6 inscripciones')

  // ══════════════════════════════════════
  // ASIGNACIONES DOCENTE-MATERIA-CURSO
  // ══════════════════════════════════════
  const dmc = async (docenteId: number, materiaId: number, cursoId: number) => {
    return prisma.docenteMateriaCurso.upsert({
      where:  { docenteId_materiaId_cursoId_gestionId: { docenteId, materiaId, cursoId, gestionId: gestion.id } },
      update: {},
      create: { docenteId, materiaId, cursoId, gestionId: gestion.id },
    })
  }

  // 1A: Mamani da MAT, Quispe da LEN, Flores da ING y EFI, Condori da CNA y CSO
  const dmc1 = await dmc(doc1.id, mMAT.id, c1A.id)
  const dmc2 = await dmc(doc2.id, mLEN.id, c1A.id)
  const dmc3 = await dmc(doc3.id, mING.id, c1A.id)
  const dmc4 = await dmc(doc3.id, mEFI.id, c1A.id)
  const dmc5 = await dmc(doc4.id, mCNA.id, c1A.id)
  const dmc6 = await dmc(doc4.id, mCSO.id, c1A.id)
  // 1B y 2A: mismos docentes
  await dmc(doc1.id, mMAT.id, c1B.id)
  await dmc(doc2.id, mLEN.id, c1B.id)
  await dmc(doc1.id, mMAT.id, c2A.id)
  await dmc(doc2.id, mLEN.id, c2A.id)
  console.log('✓ Asignaciones docente-materia-curso')

  // ══════════════════════════════════════
  // ASISTENCIA (T1 — 10 días de clases)
  // ══════════════════════════════════════
  const fechasT1 = [
    '2025-02-03','2025-02-05','2025-02-10','2025-02-12','2025-02-17',
    '2025-02-19','2025-02-24','2025-02-26','2025-03-03','2025-03-05',
  ]

  const inscC1A = [insc1, insc2, insc3, insc4]

  // Asistencia en MAT (dmc1) — variada para probar alertas
  const estadosMAT: Array<'PRESENTE'|'AUSENTE'|'JUSTIFICADO'> = [
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
  ] as any

  for (let d = 0; d < fechasT1.length; d++) {
    for (let e = 0; e < inscC1A.length; e++) {
      try {
        await prisma.asistencia.create({
          data: {
            inscripcionId:         inscC1A[e].id,
            docenteMateriaCursoId: dmc1.id,
            fecha:                 new Date(fechasT1[d]),
            estado:                estadosMAT[d][e] as EstadoAsistencia,
          },
        })
      } catch { /* ya existe */ }
    }
  }

  // Asistencia en LEN (dmc2) — todos presentes mayormente
  for (const fecha of fechasT1) {
    for (const insc of inscC1A) {
      try {
        await prisma.asistencia.create({
          data: {
            inscripcionId:         insc.id,
            docenteMateriaCursoId: dmc2.id,
            fecha:                 new Date(fecha),
            estado:                Math.random() > 0.1 ? 'PRESENTE' : 'AUSENTE',
          },
        })
      } catch { /* ya existe */ }
    }
  }
  console.log('✓ Asistencia del T1 (10 días, 2 materias, 4 estudiantes)')

  // ══════════════════════════════════════
  // CALIFICACIONES T1 (cerrado)
  // ══════════════════════════════════════
  const notasT1 = {
    [insc1.id]: { mat: 78, len: 82, cna: 75, cso: 80, ing: 70, efi: 90 },
    [insc2.id]: { mat: 65, len: 58, cna: 62, cso: 70, ing: 55, efi: 85 },
    [insc3.id]: { mat: 85, len: 90, cna: 88, cso: 82, ing: 78, efi: 92 },
    [insc4.id]: { mat: 45, len: 50, cna: 48, cso: 55, ing: 40, efi: 75 },
  }

  const dmcMap = [
    { dmc: dmc1, key: 'mat' },
    { dmc: dmc2, key: 'len' },
    { dmc: dmc5, key: 'cna' },
    { dmc: dmc6, key: 'cso' },
    { dmc: dmc3, key: 'ing' },
    { dmc: dmc4, key: 'efi' },
  ]

  for (const insc of inscC1A) {
    const notas = notasT1[insc.id]
    for (const { dmc: d, key } of dmcMap) {
      const nota = notas[key as keyof typeof notas]
      await prisma.calificacion.upsert({
        where:  { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trimestres[0].id } },
        update: {},
        create: { inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trimestres[0].id, nota, promedioTrimestral: nota },
      })
    }
  }
  console.log('✓ Calificaciones T1 (6 materias, 4 estudiantes)')

  // Promedios finales (simulados con solo T1 por ahora)
  for (const insc of inscC1A) {
    const notas = notasT1[insc.id]
    for (const { dmc: d, key } of dmcMap) {
      const nota = notas[key as keyof typeof notas]
      await prisma.promedioFinal.upsert({
        where:  { inscripcionId_docenteMateriaCursoId: { inscripcionId: insc.id, docenteMateriaCursoId: d.id } },
        update: {},
        create: { inscripcionId: insc.id, docenteMateriaCursoId: d.id, promedioFinal: nota, aprobado: nota >= 51 },
      })
    }
  }
  console.log('✓ Promedios finales T1')

  // ══════════════════════════════════════
  // ACTIVIDADES (docente Mamani — MAT)
  // ══════════════════════════════════════
  const actividades = [
    { fecha: '2025-02-03', tema: 'Números enteros y operaciones básicas', descripcion: 'Introducción a los números enteros, suma y resta.', tareaAsignada: 'Ejercicios pág. 15-16 del libro de texto' },
    { fecha: '2025-02-05', tema: 'Fracciones propias e impropias',        descripcion: 'Operaciones con fracciones. Simplificación.',         tareaAsignada: 'Taller de fracciones — hoja de ejercicios' },
    { fecha: '2025-02-10', tema: 'Números decimales',                     descripcion: 'Representación y operaciones con decimales.',         tareaAsignada: 'Ejercicios pág. 22-23' },
    { fecha: '2025-02-17', tema: 'Porcentajes y aplicaciones',            descripcion: 'Cálculo de porcentajes en problemas cotidianos.',     tareaAsignada: 'Problemas de aplicación — 10 ejercicios' },
    { fecha: '2025-02-24', tema: 'Álgebra — introducción a variables',    descripcion: 'Concepto de variable y expresiones algebraicas.',     tareaAsignada: 'Página 35 — identificar variables' },
  ]

  for (const act of actividades) {
    await prisma.actividad.create({
      data: { docenteMateriaCursoId: dmc1.id, fecha: new Date(act.fecha), tema: act.tema, descripcion: act.descripcion, tareaAsignada: act.tareaAsignada },
    }).catch(() => {/* ignora duplicados */})
  }
  console.log('✓ 5 actividades docente')

  // ══════════════════════════════════════
  // CONCEPTOS DE PAGO
  // ══════════════════════════════════════
  const cp1 = await prisma.conceptoPago.upsert({
    where:  { id: 1 },
    update: {},
    create: { nombre: 'Matrícula 2025',           descripcion: 'Pago de matrícula para la gestión escolar 2025.',              monto: 150.00, obligatorio: true,  gestionId: gestion.id },
  }).catch(async () =>
    prisma.conceptoPago.create({ data: { nombre: 'Matrícula 2025', descripcion: 'Pago de matrícula para la gestión escolar 2025.', monto: 150.00, obligatorio: true, gestionId: gestion.id } })
  )

  const cp2 = await prisma.conceptoPago.create({
    data: { nombre: 'Material Didáctico',         descripcion: 'Contribución para material didáctico y fotocopias.',           monto:  80.00, obligatorio: true,  gestionId: gestion.id },
  }).catch(async (e: any) => prisma.conceptoPago.findFirst({ where: { nombre: 'Material Didáctico', gestionId: gestion.id } })) as any

  const cp3 = await prisma.conceptoPago.create({
    data: { nombre: 'Mantenimiento Infraestructura', descripcion: 'Contribución voluntaria para mantenimiento de instalaciones.', monto:  50.00, obligatorio: false, gestionId: gestion.id },
  }).catch(async () => prisma.conceptoPago.findFirst({ where: { nombre: 'Mantenimiento Infraestructura', gestionId: gestion.id } })) as any

  console.log('✓ 3 conceptos de pago')

  // ══════════════════════════════════════
  // PAGOS
  // ══════════════════════════════════════
  const crearPago = async (
    inscripcionId: number,
    conceptoPagoId: number,
    monto: number,
    metodo: 'EFECTIVO'|'TRANSFERENCIA'|'QR',
    recibo: string,
    estado: 'PAGADO'|'ANULADO' = 'PAGADO'
  ) => {
    try {
      return await prisma.pago.create({
        data: { inscripcionId, conceptoPagoId, montoPagado: monto, metodoPago: metodo, estado, numeroRecibo: recibo, registradoPorId: uSec.id },
      })
    } catch { return null }
  }

  // Ana — pagó todo
  await crearPago(insc1.id, cp1.id, 150, 'EFECTIVO',      'REC-2025-0001')
  await crearPago(insc1.id, cp2.id,  80, 'EFECTIVO',      'REC-2025-0002')
  await crearPago(insc1.id, cp3.id,  50, 'QR',            'REC-2025-0003')

  // Pedro — solo matrícula
  await crearPago(insc2.id, cp1.id, 150, 'TRANSFERENCIA', 'REC-2025-0004')

  // Lucía — pagó matrícula y material
  await crearPago(insc3.id, cp1.id, 150, 'EFECTIVO',      'REC-2025-0005')
  await crearPago(insc3.id, cp2.id,  80, 'QR',            'REC-2025-0006')

  // Miguel — pago anulado y repagado
  await crearPago(insc4.id, cp1.id, 150, 'EFECTIVO',      'REC-2025-0007', 'ANULADO')
  await crearPago(insc4.id, cp1.id, 150, 'EFECTIVO',      'REC-2025-0008')
  await crearPago(insc4.id, cp2.id,  80, 'QR',            'REC-2025-0009')

  // Valeria — nada pagado (sin registros)
  console.log('✓ Pagos registrados (Ana todo, Pedro solo matrícula, Lucía 2/3, Miguel con anulado, Valeria sin pagar)')

  // ══════════════════════════════════════
  // RESUMEN DE ASISTENCIA (calculado para T1)
  // ══════════════════════════════════════
  // Porcentajes reales basados en los registros de asistencia
  const resumenData = [
    // insc1 (Ana) — MAT: 10P/0A/0J = 100%, LEN: 9P/1A = 90%
    { inscripcionId: insc1.id, docenteMateriaCursoId: dmc1.id, trimestreId: trimestres[0].id, totalClases: 10, totalPresente: 10, totalAusente: 0, totalJustificado: 0, porcentaje: 100 },
    { inscripcionId: insc1.id, docenteMateriaCursoId: dmc2.id, trimestreId: trimestres[0].id, totalClases: 10, totalPresente:  9, totalAusente: 1, totalJustificado: 0, porcentaje:  90 },
    // insc2 (Pedro) — MAT: 6P/4A = 60% (ALERTA), LEN: 8P/2A = 80%
    { inscripcionId: insc2.id, docenteMateriaCursoId: dmc1.id, trimestreId: trimestres[0].id, totalClases: 10, totalPresente:  6, totalAusente: 4, totalJustificado: 0, porcentaje:  60 },
    { inscripcionId: insc2.id, docenteMateriaCursoId: dmc2.id, trimestreId: trimestres[0].id, totalClases: 10, totalPresente:  8, totalAusente: 2, totalJustificado: 0, porcentaje:  80 },
    // insc3 (Lucía) — MAT: 9P/1A = 90%, LEN: 10P = 100%
    { inscripcionId: insc3.id, docenteMateriaCursoId: dmc1.id, trimestreId: trimestres[0].id, totalClases: 10, totalPresente:  9, totalAusente: 1, totalJustificado: 0, porcentaje:  90 },
    { inscripcionId: insc3.id, docenteMateriaCursoId: dmc2.id, trimestreId: trimestres[0].id, totalClases: 10, totalPresente: 10, totalAusente: 0, totalJustificado: 0, porcentaje: 100 },
    // insc4 (Miguel) — MAT: 4P/6A = 40% (CRÍTICO), LEN: 7P/3A = 70% (ALERTA)
    { inscripcionId: insc4.id, docenteMateriaCursoId: dmc1.id, trimestreId: trimestres[0].id, totalClases: 10, totalPresente:  4, totalAusente: 6, totalJustificado: 0, porcentaje:  40 },
    { inscripcionId: insc4.id, docenteMateriaCursoId: dmc2.id, trimestreId: trimestres[0].id, totalClases: 10, totalPresente:  7, totalAusente: 3, totalJustificado: 0, porcentaje:  70 },
  ]

  for (const r of resumenData) {
    await prisma.resumenAsistencia.upsert({
      where:  { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: r.inscripcionId, docenteMateriaCursoId: r.docenteMateriaCursoId, trimestreId: r.trimestreId } },
      update: {},
      create: r,
    })
  }
  console.log('✓ Resúmenes de asistencia T1 (incluye casos con alerta < 80%)')

  // ══════════════════════════════════════
  // RESUMEN FINAL
  // ══════════════════════════════════════
  console.log('\n═══════════════════════════════════════')
  console.log('✅ Seed completado exitosamente')
  console.log('═══════════════════════════════════════')
  console.log('\nCREDENCIALES DE ACCESO:')
  console.log('┌────────────────┬─────────────┬─────────────┐')
  console.log('│ Usuario        │ Contraseña  │ Rol         │')
  console.log('├────────────────┼─────────────┼─────────────┤')
  console.log('│ director       │ admin1234   │ DIRECTOR    │')
  console.log('│ secretaria     │ sec1234     │ SECRETARIA  │')
  console.log('│ doc_mamani     │ doc1234     │ DOCENTE     │')
  console.log('│ doc_quispe     │ doc1234     │ DOCENTE     │')
  console.log('│ doc_flores     │ doc1234     │ DOCENTE     │')
  console.log('│ doc_condori    │ doc1234     │ DOCENTE     │')
  console.log('│ est_ana        │ est1234     │ ESTUDIANTE  │')
  console.log('│ est_pedro      │ est1234     │ ESTUDIANTE  │')
  console.log('│ tut_rosa       │ tut1234     │ TUTOR       │')
  console.log('└────────────────┴─────────────┴─────────────┘')
  console.log('\nDATOS DE PRUEBA INTERESANTES:')
  console.log('• Pedro (est_pedro): asistencia MAT 60% → debería aparecer en alertas')
  console.log('• Miguel (est_miguel): asistencia MAT 40% → caso crítico')
  console.log('• Miguel: tiene un pago ANULADO + repago → probar historial')
  console.log('• Valeria: sin ningún pago → probar estado pendiente')
  console.log('• T1 cerrado → intentar editar notas debe retornar 403')
  console.log('• T2 y T3 abiertos → registrar notas normalmente')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())