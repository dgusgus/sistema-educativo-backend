// src/lib/cuaderno.calculo.ts
//
// Matemática y textos PUROS del cuaderno pedagógico (sin base de datos ni Excel).
//
// ¿Para qué? El Excel original calculaba todo con fórmulas repetidas en 27 hojas
// (y algunas copias quedaron rotas). Aquí cada regla vive UNA vez, y se prueba en
// tests/cuaderno.calculo.test.ts. El libro Excel y, más adelante, el PDF solo
// "dibujan" lo que sale de estas funciones, así nunca muestran números distintos.

import type { Nivel, Turno } from '../../prisma/generated/prisma/enums.js'

// Redondeo "normal" (0.5 sube), igual que ROUND() de Excel para positivos.
// Se evita Math.round directo sobre decimales binarios: 1.005 * 100 = 100.49999...
export function redondear(valor: number, decimales = 0): number {
  const factor = 10 ** decimales
  return Math.round((valor + Number.EPSILON) * factor) / factor
}

// ─── Textos ──────────────────────────────────────────────────────────────────

const ORDINALES = ['', 'PRIMERO', 'SEGUNDO', 'TERCERO', 'CUARTO', 'QUINTO', 'SEXTO']

/** 3 → "TERCERO" (los cursos de Bolivia llegan hasta sexto en cada nivel). */
export function gradoEnTexto(grado: number): string {
  return ORDINALES[grado] ?? `${grado}°`
}

/** PRIMARIA → "PRIMARIO", como se escribe en la carátula oficial. */
export function nivelEnTexto(nivel: Nivel): string {
  return nivel === 'PRIMARIA' ? 'PRIMARIO' : 'SECUNDARIO'
}

export function turnoEnTexto(turno: Turno): string {
  return { MANANA: 'MAÑANA', TARDE: 'TARDE', NOCHE: 'NOCHE' }[turno]
}

// ─── Notas ───────────────────────────────────────────────────────────────────

export interface DimensionPuntos {
  esAutoevaluada: boolean
  /** promedio de la dimensión en su propia escala (p. ej. 0-45 para Saber); null = sin notas */
  promedio: number | null
}

/**
 * "Promedio desarrollo curricular" del Excel: suma de las dimensiones que evalúa el
 * maestro (Ser + Saber + Hacer), SIN la autoevaluación. null si ninguna tiene nota.
 */
export function desarrolloCurricular(dimensiones: DimensionPuntos[]): number | null {
  const evaluadas = dimensiones.filter(d => !d.esAutoevaluada && d.promedio !== null)
  if (evaluadas.length === 0) return null
  return redondear(evaluadas.reduce((s, d) => s + d.promedio!, 0))
}

/** Suma de las dimensiones autoevaluadas (en el Excel: "AUTOEVALUACIÓN - 5 Pts"). */
export function autoevaluacion(dimensiones: DimensionPuntos[]): number | null {
  const propias = dimensiones.filter(d => d.esAutoevaluada && d.promedio !== null)
  if (propias.length === 0) return null
  return redondear(propias.reduce((s, d) => s + d.promedio!, 0))
}

// ─── Estadísticas al pie de cada hoja ────────────────────────────────────────

export interface ResumenNotas {
  totalEstudiantes: number
  aprobados: number
  reprobados: number
  /** promedio de los totales, redondeado a entero; null si nadie tiene nota */
  promedio: number | null
  porcentajeAprobados: number | null
  porcentajeReprobados: number | null
}

/**
 * Misma lógica que el pie de las hojas del Excel (TOTAL DE ESTUDIANTES, APROBADOS,
 * REPROBADOS, PROMEDIO, %), pero el mínimo de aprobación sale de la gestión
 * (Gestion.notaMinimaAprobacion) en vez de estar escrito como ">50" en cada celda.
 * Solo cuentan los estudiantes que ya tienen nota (> 0).
 */
export function resumirNotas(totales: Array<number | null>, notaMinima: number): ResumenNotas {
  const conNota = totales.filter((t): t is number => t !== null && t > 0)
  const total = conNota.length
  const aprobados = conNota.filter(t => t >= notaMinima).length
  const reprobados = total - aprobados
  return {
    totalEstudiantes: total,
    aprobados,
    reprobados,
    promedio: total > 0 ? redondear(conNota.reduce((s, t) => s + t, 0) / total) : null,
    porcentajeAprobados: total > 0 ? redondear((aprobados * 100) / total, 1) : null,
    porcentajeReprobados: total > 0 ? redondear((reprobados * 100) / total, 1) : null,
  }
}

// ─── Centralizador por área (notas de todos los trimestres) ──────────────────

export type ObservacionAnual = 'PROMOVIDO' | 'RETENIDO'

export interface AnualCalculado {
  /** promedio anual como entero (así se muestra en el cuaderno); null si faltan trimestres */
  promedio: number | null
  resultado: ObservacionAnual | null
}

/**
 * Promedio anual y observación de UNA materia, con la misma regla que ya usa el sistema
 * (lib/promedio-final.helper.ts): solo se decide cuando existen las notas de TODOS los
 * trimestres; el promedio es el de los trimestrales con 2 decimales y se compara con la
 * nota mínima de la gestión. El cuaderno muestra el promedio redondeado a entero, pero la
 * decisión se toma con los 2 decimales para que PROMOVIDO/RETENIDO sea el mismo que en
 * Promoción de Gestión.
 *
 * En papel esta columna dice "RETENIDO" (en el sistema el estado se llama REPROBADO).
 */
export function calcularAnual(trimestrales: Array<number | null>, notaMinima: number): AnualCalculado {
  if (trimestrales.length === 0 || trimestrales.some(t => t === null)) return { promedio: null, resultado: null }
  const notas = trimestrales as number[]
  const exacto = redondear(notas.reduce((s, n) => s + n, 0) / notas.length, 2)
  return { promedio: redondear(exacto), resultado: exacto >= notaMinima ? 'PROMOVIDO' : 'RETENIDO' }
}

export interface ResumenCentralizador {
  totalEstudiantes: number
  aprobados: number
  reprobados: number
  promedio: number | null
  porcentajeAprobados: number | null
  porcentajeReprobados: number | null
}

/** Pie del centralizador: cuenta SOLO a quienes ya tienen decisión anual, con lo que dice la columna Observación. */
export function resumirCentralizador(filas: AnualCalculado[]): ResumenCentralizador {
  const decididos = filas.filter(f => f.resultado !== null && f.promedio !== null)
  const total = decididos.length
  const aprobados = decididos.filter(f => f.resultado === 'PROMOVIDO').length
  const reprobados = total - aprobados
  return {
    totalEstudiantes: total,
    aprobados,
    reprobados,
    promedio: total > 0 ? redondear(decididos.reduce((s, f) => s + f.promedio!, 0) / total) : null,
    porcentajeAprobados: total > 0 ? redondear((aprobados * 100) / total, 1) : null,
    porcentajeReprobados: total > 0 ? redondear((reprobados * 100) / total, 1) : null,
  }
}
