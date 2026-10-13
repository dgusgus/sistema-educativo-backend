import { describe, it, expect, vi } from 'vitest'

// El service importa prisma; para probar la matemática pura no hace falta base de datos.
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }))
const { calcularResumen } = await import('../src/services/asistencia-resumen.service.js')

describe('calcularResumen (asistencia)', () => {
  it('sin registros → null (no se escribe resumen)', () => {
    expect(calcularResumen(1, { presente: 0, ausente: 0, retraso: 0, justificado: 0 })).toBeNull()
  })

  it('RETRASO es falta parcial: no suma al porcentaje; JUSTIFICADO sí', () => {
    const r = calcularResumen(7, { presente: 6, ausente: 1, retraso: 2, justificado: 1 })!
    expect(r.totalClases).toBe(10)
    expect(r.porcentaje).toBe(70)          // (6 + 1) / 10
    expect(r.inscripcionId).toBe(7)
  })

  it('exactamente 80 % NO es alerta (el umbral es "menor que 80")', () => {
    const r = calcularResumen(1, { presente: 8, ausente: 2, retraso: 0, justificado: 0 })!
    expect(r.porcentaje).toBe(80)
  })
})
