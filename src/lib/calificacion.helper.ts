// src/lib/calificacion.helper.ts
//
// ÚNICO escritor de CalificacionDimension.promedio y Calificacion.promedioTrimestral
// (tal como pide el comentario del schema). Se llama después de cualquier cambio
// en NotaActividad. La matemática vive en calificacion.calculo.ts (pura y testeada);
// este archivo solo lee los datos, llama al cálculo y guarda el resultado.
//
// ── Qué cambió y por qué ────────────────────────────────────────────────────
// Antes, por CADA estudiante se ejecutaban ~3 + 2×(dimensiones) consultas, una tras
// otra y sin transacción. Al registrar las notas de un curso de 40 estudiantes con
// 4 dimensiones eran ~480 consultas secuenciales y, si una fallaba a la mitad, quedaban
// promedios de unos estudiantes actualizados y de otros no.
//
// Ahora, para TODO el lote: 4 lecturas fijas (sin importar cuántos estudiantes) y las
// escrituras en UNA transacción: o se guardan todos los promedios o ninguno.

import { prisma } from './prisma.js'
import type { Prisma } from '../../prisma/generated/prisma/client.js'
import { calcularPromedioTrimestral, type ActividadCalculo } from './calificacion.calculo.js'

export interface PromedioCalculado {
  inscripcionId:      number
  promedioTrimestral: number | null
}

export async function recalcularCalificaciones(
  inscripcionIds: number[],
  docenteMateriaCursoId: number,
  trimestreId: number,
): Promise<PromedioCalculado[]> {
  const ids = [...new Set(inscripcionIds)]
  if (ids.length === 0) return []

  // 1-2) Configuración: dimensiones de la gestión
  const dmc = await prisma.docenteMateriaCurso.findUniqueOrThrow({
    where:  { id: docenteMateriaCursoId },
    select: { gestionId: true },
  })
  const dimensiones = await prisma.dimensionEvaluacion.findMany({
    where:   { gestionId: dmc.gestionId },
    orderBy: { orden: 'asc' },
    select:  { id: true, puntajeMaximo: true, pesoEnPromedio: true },
  })
  const dimensionesCalculo = dimensiones.map(d => ({
    id: d.id, puntajeMaximo: Number(d.puntajeMaximo), pesoEnPromedio: Number(d.pesoEnPromedio),
  }))

  // 3) Actividades activas con las notas de ESTOS estudiantes (una sola consulta)
  const actividadesBD = await prisma.actividadEvaluativa.findMany({
    where:  { docenteMateriaCursoId, trimestreId, activo: true },
    select: {
      dimensionId: true, puntajeMaximo: true, peso: true,
      notas: { where: { inscripcionId: { in: ids } }, select: { inscripcionId: true, nota: true } },
    },
  })

  // Índice nota por (actividad, estudiante) para no buscar en listas dentro del bucle
  const actividades = actividadesBD.map(a => ({
    dimensionId:   a.dimensionId,
    puntajeMaximo: Number(a.puntajeMaximo),
    peso:          Number(a.peso),
    notaPorInscripcion: new Map(a.notas.map(n => [n.inscripcionId, Number(n.nota)] as const)),
  }))

  // 4) Asegurar que exista la fila Calificacion de cada estudiante y traer sus ids
  await prisma.calificacion.createMany({
    data: ids.map(inscripcionId => ({ inscripcionId, docenteMateriaCursoId, trimestreId })),
    skipDuplicates: true,
  })
  const calificaciones = await prisma.calificacion.findMany({
    where:  { inscripcionId: { in: ids }, docenteMateriaCursoId, trimestreId },
    select: { id: true, inscripcionId: true },
  })
  const calificacionIdPorInscripcion = new Map(calificaciones.map(c => [c.inscripcionId, c.id]))

  // Cálculo en memoria + escrituras preparadas
  const resultados: PromedioCalculado[] = []
  const escrituras: Prisma.PrismaPromise<unknown>[] = []

  for (const inscripcionId of ids) {
    const calificacionId = calificacionIdPorInscripcion.get(inscripcionId)
    if (calificacionId === undefined) continue   // no debería pasar: se acaba de crear

    const delEstudiante: ActividadCalculo[] = actividades.map(a => ({
      dimensionId:   a.dimensionId,
      puntajeMaximo: a.puntajeMaximo,
      peso:          a.peso,
      nota:          a.notaPorInscripcion.get(inscripcionId) ?? null,
    }))

    const { promediosDimension, promedioTrimestral } = calcularPromedioTrimestral(dimensionesCalculo, delEstudiante)

    for (const [dimensionId, promedio] of promediosDimension) {
      escrituras.push(prisma.calificacionDimension.upsert({
        where:  { calificacionId_dimensionId: { calificacionId, dimensionId } },
        update: { promedio },
        create: { calificacionId, dimensionId, promedio },
      }))
    }
    escrituras.push(prisma.calificacion.update({ where: { id: calificacionId }, data: { promedioTrimestral } }))
    resultados.push({ inscripcionId, promedioTrimestral })
  }

  // 5) Todo o nada
  await prisma.$transaction(escrituras)
  return resultados
}

// Versión de un solo estudiante (compatibilidad con el código existente).
export async function recalcularCalificacion(
  inscripcionId: number,
  docenteMateriaCursoId: number,
  trimestreId: number,
): Promise<PromedioCalculado> {
  const [resultado] = await recalcularCalificaciones([inscripcionId], docenteMateriaCursoId, trimestreId)
  return resultado ?? { inscripcionId, promedioTrimestral: null }
}
