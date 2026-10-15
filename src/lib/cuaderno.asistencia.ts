// src/lib/cuaderno.asistencia.ts
//
// Reglas PURAS (sin base de datos ni Excel) de la hoja de asistencia mensual del cuaderno.
//
// El sistema guarda la asistencia POR MATERIA y por día (Asistencia.docenteMateriaCursoId),
// pero el cuaderno de primaria lleva UNA lista por día para todo el curso, porque el
// maestro de aula es el mismo. Mientras no exista un registro "de aula" propio, la hoja
// toma lo que ya hay y lo reduce a un solo estado por estudiante y día con estas reglas.

import type { EstadoAsistencia } from '../../prisma/generated/prisma/enums.js'

/** Códigos del cuaderno: A = asistencia, F = falta, R = retraso, L = licencia (justificado). */
export type LetraAsistencia = 'A' | 'F' | 'R' | 'L'

export const LETRA_POR_ESTADO: Record<EstadoAsistencia, LetraAsistencia> = {
  PRESENTE: 'A',
  AUSENTE: 'F',
  RETRASO: 'R',
  JUSTIFICADO: 'L',
}

// Para desempatar: ante dudas, el estado que más importa registrar gana.
const SEVERIDAD: Record<LetraAsistencia, number> = { F: 3, R: 2, L: 1, A: 0 }

/**
 * Un solo estado por estudiante y día.
 *  • Si hay un solo registro (el caso de primaria), es ese.
 *  • Si hay varios (secundaria: una asistencia por materia), gana el estado más
 *    frecuente; si empatan, el más grave (falta > retraso > licencia > asistencia).
 * null = no hay ningún registro ese día.
 */
export function estadoDelDia(estados: EstadoAsistencia[]): LetraAsistencia | null {
  if (estados.length === 0) return null
  const cuenta = new Map<LetraAsistencia, number>()
  for (const e of estados) {
    const letra = LETRA_POR_ESTADO[e]
    cuenta.set(letra, (cuenta.get(letra) ?? 0) + 1)
  }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || SEVERIDAD[b[0]] - SEVERIDAD[a[0]])[0][0]
}

export function contarLetras(letras: Iterable<LetraAsistencia>): Record<LetraAsistencia, number> {
  const total: Record<LetraAsistencia, number> = { A: 0, F: 0, R: 0, L: 0 }
  for (const l of letras) total[l]++
  return total
}

// ─── Calendario ──────────────────────────────────────────────────────────────
// Las fechas se manejan como texto "AAAA-MM-DD" y se calculan en UTC. Un campo
// @db.Date llega como medianoche UTC: si se leyera con la zona horaria local
// (Bolivia es UTC-4) el día se correría al anterior.

export function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export const NOMBRE_MES = ['', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
export const ABREVIATURA_MES = ['', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']

/** Letra del día de la semana como en el cuaderno (martes y miércoles son "M"). */
const LETRA_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

export interface MesCalendario { anio: number; mes: number }

/** Todos los meses (año + mes) que toca el rango [desde, hasta], en orden. */
export function mesesDelRango(desde: string, hasta: string): MesCalendario[] {
  const [a1, m1] = desde.split('-').map(Number)
  const [a2, m2] = hasta.split('-').map(Number)
  const meses: MesCalendario[] = []
  for (let a = a1, m = m1; a < a2 || (a === a2 && m <= m2); m === 12 ? (a++, m = 1) : m++) {
    meses.push({ anio: a, mes: m })
  }
  return meses
}

export interface DiaCalendario {
  fecha: string        // "2026-03-05"
  dia: number          // 5
  letra: string        // "J"
}

/**
 * Días de clase de un mes dentro del rango del trimestre: lunes a viernes, más los
 * sábados SOLO si ese día se pasó lista (hay colegios con clases los sábados).
 * Los feriados no se descartan: quedan en la hoja y en blanco, para que el maestro
 * vea el calendario completo igual que en el cuaderno de papel.
 */
export function diasDelMes(
  anio: number, mes: number, desde: string, hasta: string, sabadosConRegistro: ReadonlySet<string>,
): DiaCalendario[] {
  const dias: DiaCalendario[] = []
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()   // día 0 del mes siguiente = último de este
  for (let dia = 1; dia <= ultimo; dia++) {
    const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    if (fecha < desde || fecha > hasta) continue
    const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()
    if (diaSemana === 0) continue
    if (diaSemana === 6 && !sabadosConRegistro.has(fecha)) continue
    dias.push({ fecha, dia, letra: LETRA_DIA[diaSemana] })
  }
  return dias
}
