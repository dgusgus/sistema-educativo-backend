// src/lib/calificacion.calculo.ts
//
// Matemática PURA del promedio trimestral (sin base de datos).
//
// ¿Para qué separarla de calificacion.helper.ts? Porque la regla de negocio más
// importante del sistema ("¿qué nota final tiene el estudiante?") no debe depender de
// Prisma para poder probarse. Aquí entran números y salen números: se testea en
// milisegundos (ver tests/calificacion.calculo.test.ts) y, si la regla cambia
// (otro peso, otra escala), el cambio se hace y se prueba en UN solo archivo.
//
// Regla (idéntica a la que ya usaba el sistema, documentada en calificacion.helper.ts):
//  1. Cada actividad se normaliza a porcentaje: nota / puntajeMaximo.
//  2. Dentro de una dimensión, los porcentajes se ponderan por el peso de la actividad.
//  3. promedio de la dimensión = porcentaje ponderado × puntajeMaximo de la dimensión.
//  4. Promedio trimestral = porcentajes de dimensión ponderados por pesoEnPromedio × 100.
//  5. Una dimensión sin ninguna nota todavía NO cuenta como 0: se omite.

export interface DimensionCalculo {
  id:             number
  puntajeMaximo:  number
  pesoEnPromedio: number
}

export interface ActividadCalculo {
  dimensionId:   number
  puntajeMaximo: number
  peso:          number
  /** null = el estudiante todavía no tiene nota en esta actividad */
  nota:          number | null
}

export interface ResultadoCalculo {
  /** dimensionId → promedio de la dimensión en la escala propia de la dimensión */
  promediosDimension: Map<number, number>
  /** 0-100, redondeado a 2 decimales; null si no hay ninguna nota */
  promedioTrimestral: number | null
}

export function calcularPromedioTrimestral(
  dimensiones: DimensionCalculo[],
  actividades: ActividadCalculo[],
): ResultadoCalculo {
  const porDimension = new Map<number, ActividadCalculo[]>()
  for (const a of actividades) {
    if (a.nota === null) continue
    // Una actividad con puntaje máximo inválido no se puede normalizar: se ignora
    // (antes producía NaN y la escritura a la base de datos fallaba con un 500).
    if (!(a.puntajeMaximo > 0)) continue
    const lista = porDimension.get(a.dimensionId)
    if (lista) lista.push(a)
    else porDimension.set(a.dimensionId, [a])
  }

  const promediosDimension = new Map<number, number>()
  let sumaPonderada = 0
  let sumaPesos     = 0

  for (const dimension of dimensiones) {
    const evaluadas = porDimension.get(dimension.id)
    if (!evaluadas || evaluadas.length === 0) continue   // sin notas: no cuenta como 0

    let sumaPctPonderada  = 0
    let sumaPesoActividad = 0
    for (const act of evaluadas) {
      sumaPctPonderada  += (act.nota! / act.puntajeMaximo) * act.peso
      sumaPesoActividad += act.peso
    }
    // Todas las actividades con peso 0 → no hay base para ponderar: se omite la dimensión.
    if (sumaPesoActividad <= 0) continue

    const pctDimension = sumaPctPonderada / sumaPesoActividad
    promediosDimension.set(dimension.id, pctDimension * dimension.puntajeMaximo)

    sumaPonderada += pctDimension * dimension.pesoEnPromedio
    sumaPesos     += dimension.pesoEnPromedio
  }

  const promedioTrimestral =
    sumaPesos > 0 ? Math.round((sumaPonderada / sumaPesos) * 100 * 100) / 100 : null

  return { promediosDimension, promedioTrimestral }
}
