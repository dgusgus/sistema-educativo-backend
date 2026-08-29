// src/lib/contexto-academico.helper.ts
//
// El comentario del schema v6 sobre Asistencia es explícito: la FK
// compuesta protege Inscripcion↔Curso y DocenteMateriaCurso↔Curso por
// separado, pero NADA impide que una fila de Asistencia (o Calificacion,
// NotaActividad, PromedioFinal, ActividadEvaluativa, ResumenAsistencia)
// combine una inscripción, una asignación docente-materia-curso y un
// trimestre que en realidad son de gestiones o cursos distintos.
//
// Este validador es el único punto por el que deben pasar los creates/
// updates de esas tablas, tal como pide el comentario del schema.

import { prisma } from './prisma.js'

// Devuelve un mensaje de error si el contexto es inconsistente, o null
// si todo pertenece a la misma gestión y al mismo curso.
export async function validarContextoAcademico(
  inscripcionId: number,
  docenteMateriaCursoId: number,
  trimestreId: number
): Promise<string | null> {
  const [inscripcion, dmc, trimestre] = await Promise.all([
    prisma.inscripcion.findUnique({ where: { id: inscripcionId }, select: { gestionId: true, cursoId: true } }),
    prisma.docenteMateriaCurso.findUnique({ where: { id: docenteMateriaCursoId }, select: { gestionId: true, cursoId: true } }),
    prisma.trimestre.findUnique({ where: { id: trimestreId }, select: { gestionId: true } }),
  ])

  if (!inscripcion) return 'La inscripción no existe'
  if (!dmc)          return 'La asignación docente-materia-curso no existe'
  if (!trimestre)    return 'El trimestre no existe'

  if (inscripcion.gestionId !== dmc.gestionId || dmc.gestionId !== trimestre.gestionId) {
    return 'La inscripción, la asignación docente-materia-curso y el trimestre no pertenecen a la misma gestión'
  }
  if (inscripcion.cursoId !== dmc.cursoId) {
    return 'El estudiante no está inscrito en el curso de esta asignación docente-materia'
  }
  return null
}

// Variante para validar varias inscripciones contra el mismo
// docenteMateriaCurso + trimestre de una sola vez (ej. al registrar la
// asistencia de todo un curso). Devuelve las inscripcionIds que fallan.
export async function validarContextoAcademicoLote(
  inscripcionIds: number[],
  docenteMateriaCursoId: number,
  trimestreId: number
): Promise<{ invalidas: number[]; error: string | null }> {
  const dmc = await prisma.docenteMateriaCurso.findUnique({
    where: { id: docenteMateriaCursoId },
    select: { gestionId: true, cursoId: true },
  })
  if (!dmc) return { invalidas: [], error: 'La asignación docente-materia-curso no existe' }

  const trimestre = await prisma.trimestre.findUnique({ where: { id: trimestreId }, select: { gestionId: true } })
  if (!trimestre) return { invalidas: [], error: 'El trimestre no existe' }
  if (trimestre.gestionId !== dmc.gestionId) {
    return { invalidas: [], error: 'El trimestre no pertenece a la gestión de esta asignación' }
  }

  const inscripciones = await prisma.inscripcion.findMany({
    where: { id: { in: inscripcionIds } },
    select: { id: true, gestionId: true, cursoId: true },
  })

  const invalidas = inscripcionIds.filter(id => {
    const insc = inscripciones.find(i => i.id === id)
    return !insc || insc.gestionId !== dmc.gestionId || insc.cursoId !== dmc.cursoId
  })

  return { invalidas, error: null }
}