import { describe, it, expect } from 'vitest'
import { aFechaIso, errorFechaAsistencia } from '../src/lib/asistencia.reglas.js'
import { cambiaElCalculo, motivoBloqueoDimension } from '../src/lib/dimension.reglas.js'

const T1 = { nombre: 'Primer Trimestre', fechaInicio: new Date('2026-02-02'), fechaFin: new Date('2026-05-08') }

describe('aFechaIso', () => {
  it('acepta fecha y fecha con hora; rechaza basura e imposibles', () => {
    expect(aFechaIso('2026-03-10')).toBe('2026-03-10')
    expect(aFechaIso('2026-03-10T12:00:00.000Z')).toBe('2026-03-10')
    expect(aFechaIso('2026-02-31')).toBeNull()
    expect(aFechaIso('10/03/2026')).toBeNull()
    expect(aFechaIso(undefined)).toBeNull()
  })
})

describe('errorFechaAsistencia', () => {
  const hoy = '2026-04-15'
  it('fecha dentro del trimestre y no futura → válida', () => {
    expect(errorFechaAsistencia('2026-04-15', T1, hoy)).toBeNull()
    expect(errorFechaAsistencia('2026-02-02', T1, hoy)).toBeNull()   // borde inicio
  })
  it('fecha futura → error', () => {
    expect(errorFechaAsistencia('2026-04-16', T1, hoy)).toMatch(/futura/)
  })
  it('fecha fuera del trimestre → error con el rango', () => {
    expect(errorFechaAsistencia('2026-01-30', T1, hoy)).toMatch(/fuera de "Primer Trimestre"/)
    expect(errorFechaAsistencia('2026-05-08', T1, '2026-06-01')).toBeNull() // borde fin
    expect(errorFechaAsistencia('2026-05-09', T1, '2026-06-01')).toMatch(/fuera/)
  })
  it('formato inválido → error', () => {
    expect(errorFechaAsistencia('ayer', T1, hoy)).toMatch(/no es válida/)
  })
})

describe('dimensión: cuándo bloquear', () => {
  const actual = { puntajeMaximo: '45.00', pesoEnPromedio: '0.450' }
  it('solo cuenta si cambia puntaje o peso', () => {
    expect(cambiaElCalculo(actual, {})).toBe(false)
    expect(cambiaElCalculo(actual, { puntajeMaximo: 45, pesoEnPromedio: 0.45 })).toBe(false) // mismo valor
    expect(cambiaElCalculo(actual, { pesoEnPromedio: 0.4 })).toBe(true)
    expect(cambiaElCalculo(actual, { puntajeMaximo: 50 })).toBe(true)
  })
  it('bloquea solo si hay actividades con notas o trimestre cerrado', () => {
    expect(motivoBloqueoDimension(0)).toBeNull()
    expect(motivoBloqueoDimension(3)).toMatch(/3 actividad/)
  })
})
