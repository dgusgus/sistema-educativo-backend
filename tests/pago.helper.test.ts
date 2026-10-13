import { describe, it, expect } from 'vitest'
import { calcularDeuda } from '../src/lib/pago.helper.js'

const pago = (montoPagado: number, o: Partial<{ estado: string; montoOriginal: number; descuento: number }> = {}) =>
  ({ estado: 'PAGADO', montoOriginal: 100, descuento: 0, ...o, montoPagado })

describe('calcularDeuda (centavos enteros, sin errores de coma flotante)', () => {
  it('sin pagos → PENDIENTE con el saldo completo', () => {
    expect(calcularDeuda(100, [])).toMatchObject({ estado: 'PENDIENTE', saldo: 100, pagado: 0, abonos: 0 })
  })

  it('abono parcial → PARCIAL', () => {
    expect(calcularDeuda(100, [pago(40)])).toMatchObject({ estado: 'PARCIAL', saldo: 60, pagado: 40 })
  })

  it('dos abonos que completan la deuda → PAGADO (el 2.º no queda en PARCIAL)', () => {
    expect(calcularDeuda(100, [pago(40), pago(60)])).toMatchObject({ estado: 'PAGADO', saldo: 0, abonos: 2 })
  })

  it('el descuento reduce el saldo', () => {
    expect(calcularDeuda(100, [pago(70, { descuento: 30 })])).toMatchObject({ estado: 'PAGADO', saldo: 0 })
  })

  it('0.1 + 0.2 no deja un saldo fantasma', () => {
    const r = calcularDeuda(0.3, [pago(0.1, { montoOriginal: 0.3 }), pago(0.2, { montoOriginal: 0.3 })])
    expect(r.saldo).toBe(0)
    expect(r.estado).toBe('PAGADO')
  })

  it('los pagos ANULADOS no cuentan', () => {
    expect(calcularDeuda(100, [pago(100, { estado: 'ANULADO' })])).toMatchObject({ estado: 'PENDIENTE', saldo: 100 })
  })

  it('el precio del primer pago real fija la deuda aunque el concepto haya cambiado de precio', () => {
    expect(calcularDeuda(150, [pago(50, { montoOriginal: 100 })])).toMatchObject({ montoOriginal: 100, saldo: 50 })
  })
})
