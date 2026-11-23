// src/lib/asistencia.reglas.ts
//
// Reglas PURAS (sin base de datos) para registrar asistencia.
//
// ¿Para qué? Antes se podía registrar asistencia con cualquier fecha (futura, o de otro
// trimestre distinto al elegido) y el resumen del trimestre se alteraba sin control. Estas
// reglas viven aquí, una sola vez, y se prueban sin Prisma (tests/asistencia.reglas.test.ts).

import { hoyBolivia } from './cobranza.js'

export interface TrimestreAsistencia {
  nombre: string
  fechaInicio: Date | string
  fechaFin: Date | string
}

/** "AAAA-MM-DD" de un texto (acepta "AAAA-MM-DDTHH:mm…") o de una Date; null si no tiene ese formato. */
export function aFechaIso(valor: unknown): string | null {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10)
  if (typeof valor !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  // descarta fechas imposibles como 2026-02-31
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
    ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * null = la fecha es válida para registrar asistencia en ese trimestre;
 * si no, el mensaje para el usuario.
 * `hoy` se inyecta para poder probar sin depender del reloj.
 */
export function errorFechaAsistencia(
  fecha: unknown,
  trimestre: TrimestreAsistencia,
  hoy: string = hoyBolivia(),
): string | null {
  const f = aFechaIso(fecha)
  if (!f) return 'La fecha no es válida (formato AAAA-MM-DD)'
  if (f > hoy) return 'No se puede registrar asistencia de una fecha futura'
  const inicio = aFechaIso(trimestre.fechaInicio)!
  const fin = aFechaIso(trimestre.fechaFin)!
  if (f < inicio || f > fin) {
    return `La fecha ${f} está fuera de "${trimestre.nombre}" (${inicio} a ${fin})`
  }
  return null
}