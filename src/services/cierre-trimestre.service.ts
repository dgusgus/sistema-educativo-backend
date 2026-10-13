// src/services/cierre-trimestre.service.ts
//
// "¿Qué falta para poder cerrar el trimestre?" y "cerrar el trimestre".
//
// ── Qué cambió y por qué ────────────────────────────────────────────────────
// 1) La regla de completitud estaba COPIADA en dos controllers (cerrarTrimestre y
//    getPendientesCierre; el propio comentario decía "MISMA regla"). Dos copias
//    se desincronizan tarde o temprano. Ahora hay una sola función.
// 2) Rendimiento: por cada materia-curso (p. ej. 12 cursos × 10 materias = 120) se
//    hacían 2 consultas → 240 consultas seguidas. Ahora son 3 consultas en total y el
//    cruce se hace en memoria con Maps (O(n) en vez de O(n²) con .some()).
// 3) Integridad: antes se marcaba el trimestre como cerrado y, DESPUÉS y fuera de
//    transacción, se recalculaban los promedios finales. Si eso fallaba, quedaba un
//    trimestre cerrado (irreversible para el docente) con promedios finales a medias.
//    Ahora cerrar + recalcular es una sola transacción.
// 4) Concurrencia: dos directores pulsando "Cerrar" a la vez ya no ejecutan el cierre
//    dos veces: el UPDATE condicional (cerrado = false) lo gana uno solo.

import { prisma } from '../lib/prisma.js'
import { calcularPromediosFinales } from '../lib/promedio-final.helper.js'
import { ErrorDeUsuario, NoEncontrado } from '../lib/errores.js'

export interface PendienteMateria {
  docenteMateriaCursoId: number
  materia:  { nombre: string; codigo: string | null }
  curso:    { grado: number; paralelo: string; nivel: string }
  docente:  string
  totalEsperados: number
  registrados:    number
  faltantes: Array<{ inscripcionId: number; nombreCompleto: string }>
}

export interface PendientesCierre {
  trimestre: { id: number; numero: number; nombre: string; cerrado: boolean; gestionId: number }
  resumen: {
    totalMaterias: number; materiasCompletas: number
    totalEsperados: number; totalRegistrados: number; totalFaltantes: number
  }
  pendientes: PendienteMateria[]
}

// Solo lectura. Regla: cada DocenteMateriaCurso debe tener promedioTrimestral para
// cada estudiante ACTIVO inscrito en su curso. Las materias sin estudiantes se omiten.
export async function calcularPendientesCierre(trimestreId: number): Promise<PendientesCierre> {
  const trimestre = await prisma.trimestre.findUnique({
    where:  { id: trimestreId },
    select: { id: true, numero: true, nombre: true, cerrado: true, gestionId: true },
  })
  if (!trimestre) throw new NoEncontrado('Trimestre')

  const [asignaciones, inscripciones, conNota] = await Promise.all([
    prisma.docenteMateriaCurso.findMany({
      where:  { gestionId: trimestre.gestionId },
      select: {
        id: true, cursoId: true,
        materia: { select: { nombre: true, codigo: true } },
        curso:   { select: { grado: true, paralelo: true, nivel: true } },
        docente: { select: { persona: { select: { nombre: true, apellido: true } } } },
      },
      orderBy: { cursoId: 'asc' },
    }),
    prisma.inscripcion.findMany({
      where:  { gestionId: trimestre.gestionId, estadoInscripcion: 'ACTIVA' },
      select: { id: true, cursoId: true, estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } },
    }),
    prisma.calificacion.findMany({
      where:  { trimestreId, promedioTrimestral: { not: null }, docenteMateriaCurso: { gestionId: trimestre.gestionId } },
      select: { inscripcionId: true, docenteMateriaCursoId: true },
    }),
  ])

  // curso → inscripciones activas; "asignación-inscripción" → ya tiene nota
  const inscripcionesPorCurso = new Map<number, typeof inscripciones>()
  for (const i of inscripciones) {
    const lista = inscripcionesPorCurso.get(i.cursoId)
    if (lista) lista.push(i)
    else inscripcionesPorCurso.set(i.cursoId, [i])
  }
  const tieneNota = new Set(conNota.map(c => `${c.docenteMateriaCursoId}:${c.inscripcionId}`))

  const pendientes: PendienteMateria[] = []
  let totalEsperados = 0
  let totalRegistrados = 0

  for (const dmc of asignaciones) {
    const delCurso = inscripcionesPorCurso.get(dmc.cursoId) ?? []
    if (delCurso.length === 0) continue

    const faltantes = delCurso
      .filter(i => !tieneNota.has(`${dmc.id}:${i.id}`))
      .map(i => ({
        inscripcionId:  i.id,
        nombreCompleto: `${i.estudiante.persona.apellido} ${i.estudiante.persona.nombre}`,
      }))

    totalEsperados   += delCurso.length
    totalRegistrados += delCurso.length - faltantes.length

    pendientes.push({
      docenteMateriaCursoId: dmc.id,
      materia: dmc.materia,
      curso:   dmc.curso,
      docente: `${dmc.docente.persona.apellido} ${dmc.docente.persona.nombre}`,
      totalEsperados: delCurso.length,
      registrados:    delCurso.length - faltantes.length,
      faltantes,
    })
  }

  return {
    trimestre,
    resumen: {
      totalMaterias:     pendientes.length,
      materiasCompletas: pendientes.filter(p => p.faltantes.length === 0).length,
      totalEsperados,
      totalRegistrados,
      totalFaltantes:    totalEsperados - totalRegistrados,
    },
    pendientes,
  }
}

export async function cerrarTrimestre(trimestreId: number) {
  const { trimestre, pendientes } = await calcularPendientesCierre(trimestreId)

  if (trimestre.cerrado) throw new ErrorDeUsuario('El trimestre ya está cerrado')

  const incompletos = pendientes
    .filter(p => p.faltantes.length > 0)
    .map(p => ({ docenteMateriaCursoId: p.docenteMateriaCursoId, faltantes: p.faltantes.length }))

  if (incompletos.length > 0) {
    throw new ErrorDeUsuario(
      'Hay materias con estudiantes sin promedio calculado en este trimestre',
      400,
      { sugerencia: 'Registra todas las notas de actividades pendientes antes de cerrar', incompletos },
    )
  }

  return prisma.$transaction(async tx => {
    // Condicional: si otra petición cerró el trimestre un instante antes, count = 0.
    const { count } = await tx.trimestre.updateMany({ where: { id: trimestreId, cerrado: false }, data: { cerrado: true } })
    if (count === 0) throw new ErrorDeUsuario('El trimestre ya está cerrado')

    // Solo se materializa el PromedioFinal cuando existen los 3 trimestres
    // (ver calcularPromediosFinales).
    // Se recorren TODAS las asignaciones de la gestión (no solo las que tienen
    // estudiantes activos): un estudiante retirado también conserva su promedio.
    const asignaciones = await tx.docenteMateriaCurso.findMany({ where: { gestionId: trimestre.gestionId }, select: { id: true } })
    for (const a of asignaciones) {
      await calcularPromediosFinales(a.id, trimestre.gestionId, tx)
    }
    return tx.trimestre.findUniqueOrThrow({ where: { id: trimestreId } })
  }, { timeout: 30_000 })
}
