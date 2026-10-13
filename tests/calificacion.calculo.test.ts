import { describe, it, expect } from 'vitest'
import {
  calcularPromedioTrimestral, type DimensionCalculo, type ActividadCalculo,
} from '../src/lib/calificacion.calculo.js'

const dims: DimensionCalculo[] = [
  { id: 1, puntajeMaximo: 10, pesoEnPromedio: 0.1 },   // Ser
  { id: 2, puntajeMaximo: 45, pesoEnPromedio: 0.45 },  // Saber
  { id: 3, puntajeMaximo: 45, pesoEnPromedio: 0.45 },  // Hacer
]

describe('calcularPromedioTrimestral', () => {
  it('sin ninguna nota → null (no es 0)', () => {
    const r = calcularPromedioTrimestral(dims, [
      { dimensionId: 1, puntajeMaximo: 10, peso: 1, nota: null },
    ])
    expect(r.promedioTrimestral).toBeNull()
    expect(r.promediosDimension.size).toBe(0)
  })

  it('nota perfecta en todas las dimensiones → 100', () => {
    const acts: ActividadCalculo[] = [
      { dimensionId: 1, puntajeMaximo: 10, peso: 1, nota: 10 },
      { dimensionId: 2, puntajeMaximo: 45, peso: 1, nota: 45 },
      { dimensionId: 3, puntajeMaximo: 45, peso: 1, nota: 45 },
    ]
    expect(calcularPromedioTrimestral(dims, acts).promedioTrimestral).toBe(100)
  })

  it('una dimensión sin notas se OMITE (no baja el promedio)', () => {
    const r = calcularPromedioTrimestral(dims, [
      { dimensionId: 2, puntajeMaximo: 45, peso: 1, nota: 45 },   // solo Saber, perfecto
    ])
    expect(r.promedioTrimestral).toBe(100)
    expect([...r.promediosDimension.keys()]).toEqual([2])
  })

  it('pondera las actividades de una dimensión por su peso', () => {
    // 100 % con peso 3 y 0 % con peso 1 → 75 % de la dimensión
    const r = calcularPromedioTrimestral([{ id: 1, puntajeMaximo: 100, pesoEnPromedio: 1 }], [
      { dimensionId: 1, puntajeMaximo: 20, peso: 3, nota: 20 },
      { dimensionId: 1, puntajeMaximo: 20, peso: 1, nota: 0 },
    ])
    expect(r.promediosDimension.get(1)).toBeCloseTo(75, 10)
    expect(r.promedioTrimestral).toBe(75)
  })

  it('ignora actividades con puntaje máximo inválido en vez de producir NaN', () => {
    const r = calcularPromedioTrimestral(dims, [
      { dimensionId: 1, puntajeMaximo: 0, peso: 1, nota: 5 },
      { dimensionId: 2, puntajeMaximo: 45, peso: 1, nota: 45 },
    ])
    expect(Number.isNaN(r.promedioTrimestral)).toBe(false)
    expect(r.promedioTrimestral).toBe(100)
  })

  it('actividades con peso 0 en toda la dimensión → se omite la dimensión (antes: NaN)', () => {
    const r = calcularPromedioTrimestral(dims, [
      { dimensionId: 1, puntajeMaximo: 10, peso: 0, nota: 10 },
    ])
    expect(r.promedioTrimestral).toBeNull()
  })

  it('redondea a 2 decimales', () => {
    const r = calcularPromedioTrimestral([{ id: 1, puntajeMaximo: 100, pesoEnPromedio: 1 }], [
      { dimensionId: 1, puntajeMaximo: 3, peso: 1, nota: 1 },   // 33.333…
    ])
    expect(r.promedioTrimestral).toBe(33.33)
  })
})

// ─── Equivalencia con el algoritmo ORIGINAL ──────────────────────────────────
// Copia literal de la matemática que tenía recalcularCalificacion() antes del
// refactor (calificacion.helper.ts, líneas 51-83), pero sobre datos en memoria.
// Si el refactor cambió el resultado de ALGÚN caso, este test lo detecta.
function algoritmoOriginal(dimensiones: DimensionCalculo[], actividades: ActividadCalculo[]) {
  let sumaPonderada = 0
  let sumaPesos     = 0
  for (const dimension of dimensiones) {
    const evaluadas = actividades.filter(a => a.dimensionId === dimension.id && a.nota !== null)
    if (evaluadas.length === 0) continue
    let sumaPctPonderada  = 0
    let sumaPesoActividad = 0
    for (const act of evaluadas) {
      const pct = Number(act.nota) / Number(act.puntajeMaximo)
      sumaPctPonderada  += pct * Number(act.peso)
      sumaPesoActividad += Number(act.peso)
    }
    const pctDimension = sumaPctPonderada / sumaPesoActividad
    sumaPonderada += pctDimension * Number(dimension.pesoEnPromedio)
    sumaPesos     += Number(dimension.pesoEnPromedio)
  }
  return sumaPesos > 0 ? Math.round(sumaPonderada / sumaPesos * 100 * 100) / 100 : null
}

// Generador pseudoaleatorio determinista (mulberry32) → el test es reproducible.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('equivalencia con el algoritmo original', () => {
  it('1000 casos aleatorios dan exactamente el mismo promedio trimestral', () => {
    const rand = rng(20261008)
    for (let caso = 0; caso < 1000; caso++) {
      const nDims = 1 + Math.floor(rand() * 4)
      const dimensiones: DimensionCalculo[] = Array.from({ length: nDims }, (_, i) => ({
        id: i + 1,
        puntajeMaximo:  [10, 25, 45, 100][Math.floor(rand() * 4)],
        pesoEnPromedio: Math.round((0.05 + rand() * 0.9) * 1000) / 1000,
      }))
      const nActs = Math.floor(rand() * 12)
      const actividades: ActividadCalculo[] = Array.from({ length: nActs }, () => {
        const puntajeMaximo = [5, 10, 20, 50, 100][Math.floor(rand() * 5)]
        return {
          dimensionId: 1 + Math.floor(rand() * (nDims + 1)),   // a veces una dimensión inexistente
          puntajeMaximo,
          peso: Math.round((0.1 + rand() * 4) * 1000) / 1000,  // peso > 0 (con peso 0 el original daba NaN)
          nota: rand() < 0.2 ? null : Math.round(rand() * puntajeMaximo * 100) / 100,
        }
      })

      expect(calcularPromedioTrimestral(dimensiones, actividades).promedioTrimestral)
        .toBe(algoritmoOriginal(dimensiones, actividades))
    }
  })
})
