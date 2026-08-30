// src/lib/calificacion.helper.ts
//
// v6 reemplaza la nota única por trimestre por un modelo de dimensiones
// (Ley 070: Ser/Saber/Hacer/Decidir, aunque el nombre y peso de cada
// dimensión son configurables por gestión vía DimensionEvaluacion):
//
//   NotaActividad (única fuente de verdad, una nota por actividad y
//   estudiante) → se agrupan por ActividadEvaluativa.dimensionId →
//   promedio ponderado por dimensión (CalificacionDimension) →
//   promedio ponderado final (Calificacion.promedioTrimestral).
//
// recalcularCalificacion() es el ÚNICO lugar que escribe
// CalificacionDimension.promedio y Calificacion.promedioTrimestral, tal
// como pide el comentario del schema. Se llama después de cualquier
// cambio en NotaActividad.
//
// Supuesto de cálculo (documentado porque no está en el schema):
// cada actividad se normaliza a un porcentaje (nota/puntajeMaximo),
// esos porcentajes se ponderan por ActividadEvaluativa.peso dentro de
// su dimensión, y el resultado (0-1) se multiplica por
// DimensionEvaluacion.puntajeMaximo para guardar CalificacionDimension
// en la escala propia de la dimensión. El promedio trimestral final
// vuelve a normalizar cada dimensión a porcentaje, pondera por
// DimensionEvaluacion.pesoEnPromedio, y multiplica por 100 (escala
// Ley 070). Una dimensión sin ninguna nota registrada todavía
// simplemente no entra en el promedio (no cuenta como 0).

import { prisma } from './prisma.js'

export async function recalcularCalificacion(
  inscripcionId: number,
  docenteMateriaCursoId: number,
  trimestreId: number
) {
  const dmc = await prisma.docenteMateriaCurso.findUniqueOrThrow({
    where: { id: docenteMateriaCursoId },
    select: { gestionId: true },
  })

  const dimensiones = await prisma.dimensionEvaluacion.findMany({
    where: { gestionId: dmc.gestionId },
    orderBy: { orden: 'asc' },
  })

  const calificacion = await prisma.calificacion.upsert({
    where: { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId, docenteMateriaCursoId, trimestreId } },
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
    if (evaluadas.length === 0) continue // sin notas en esta dimensión todavía — no cuenta como 0

    let sumaPctPonderada  = 0
    let sumaPesoActividad = 0
    for (const act of evaluadas) {
      const pct = Number(act.notas[0].nota) / Number(act.puntajeMaximo)
      sumaPctPonderada  += pct * Number(act.peso)
      sumaPesoActividad += Number(act.peso)
    }
    const pctDimension       = sumaPctPonderada / sumaPesoActividad
    const promedioDimension  = pctDimension * Number(dimension.puntajeMaximo)

    await prisma.calificacionDimension.upsert({
      where: { calificacionId_dimensionId: { calificacionId: calificacion.id, dimensionId: dimension.id } },
      update: { promedio: promedioDimension },
      create: { calificacionId: calificacion.id, dimensionId: dimension.id, promedio: promedioDimension },
    })

    sumaPonderada += pctDimension * Number(dimension.pesoEnPromedio)
    sumaPesos     += Number(dimension.pesoEnPromedio)
  }

  const promedioTrimestral = sumaPesos > 0 ? Math.round(sumaPonderada / sumaPesos * 100 * 100) / 100 : null

  return prisma.calificacion.update({
    where: { id: calificacion.id },
    data:  { promedioTrimestral },
    include: { dimensiones: { include: { dimension: true } } },
  })
}       