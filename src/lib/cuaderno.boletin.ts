// src/lib/cuaderno.boletin.ts
//
// Promedios GENERALES del estudiante y rankings (mejores estudiantes). Funciones puras.
//
// ¿Para qué? El boletín general, los mejores estudiantes y las libretas salen todos de
// los mismos números: la nota de cada área por trimestre (ya calculada en el centralizador
// de cada área). Aquí se promedian UNA vez, así las tres hojas nunca se contradicen.
//
// Criterio (igual que boletin.service.ts): una área sin nota NO cuenta como 0, solo se
// promedian las áreas que ya tienen nota. Los promedios generales se guardan con 2
// decimales para que dos estudiantes casi iguales no queden "empatados" por redondeo.

import { redondear } from './cuaderno.calculo.js'

export interface PromediosGenerales {
  porTrimestre: Record<number, number | null>
  anual: number | null
}

/** Forma mínima que necesitamos de los datos del cuaderno (no depende del service ni de la BD). */
export interface EntradaGenerales {
  trimestres: Array<{ id: number }>
  estudiantes: Array<{ inscripcionId: number }>
  areas: Array<{
    centralizador: {
      filas: Array<{ inscripcionId: number; porTrimestre: Record<number, number | null>; promedioAnual: number | null }>
    }
  }>
}

function promediar(valores: Array<number | null | undefined>): number | null {
  const v = valores.filter((x): x is number => x !== null && x !== undefined)
  return v.length === 0 ? null : redondear(v.reduce((s, x) => s + x, 0) / v.length, 2)
}

export function calcularGenerales(d: EntradaGenerales): Map<number, PromediosGenerales> {
  const resultado = new Map<number, PromediosGenerales>()
  for (const est of d.estudiantes) {
    const filas = d.areas.map(a => a.centralizador.filas.find(f => f.inscripcionId === est.inscripcionId))
    const porTrimestre: Record<number, number | null> = {}
    for (const t of d.trimestres) porTrimestre[t.id] = promediar(filas.map(f => f?.porTrimestre[t.id]))
    resultado.set(est.inscripcionId, { porTrimestre, anual: promediar(filas.map(f => f?.promedioAnual)) })
  }
  return resultado
}

export interface PuestoMejor {
  puesto: number
  inscripcionId: number
  promedio: number
}

/**
 * Ranking por competencia (1, 2, 2, 4): los empatados comparten puesto y el siguiente salta.
 * Corta por PUESTO, no por cantidad de filas: si el 3.er puesto está empatado entran todos
 * los empatados. Quien aún no tiene promedio no compite.
 */
export function rankear(items: Array<{ inscripcionId: number; valor: number | null }>, limite = 3): PuestoMejor[] {
  const conNota = items
    .filter((i): i is { inscripcionId: number; valor: number } => i.valor !== null)
    .sort((a, b) => b.valor - a.valor)
  const salida: PuestoMejor[] = []
  let puesto = 0
  let anterior: number | null = null
  conNota.forEach((it, idx) => {
    if (it.valor !== anterior) { puesto = idx + 1; anterior = it.valor }
    if (puesto <= limite) salida.push({ puesto, inscripcionId: it.inscripcionId, promedio: it.valor })
  })
  return salida
}
