// src/lib/pago.helper.ts
//
// Estado y saldo de un concepto de pago para UNA inscripción.
//
// Un concepto puede pagarse en varios abonos. El estado NO es de cada fila sino de la
// DEUDA completa (inscripción + concepto):
//
//   saldo = monto − Σ descuentos − Σ pagado      (sobre los pagos NO anulados)
//   saldo ≤ 0           → PAGADO
//   algo pagado         → PARCIAL
//   nada pagado         → PENDIENTE
//
// Si se comparara cada abono contra el monto completo, un 2.º abono que cierra la deuda
// seguiría figurando PARCIAL y la deuda nunca quedaría PAGADA. Por eso, al registrar o
// anular, se recalcula el estado de TODOS los pagos reales del concepto.
//
// Los cálculos se hacen en centavos enteros para evitar errores de coma flotante
// (0.1 + 0.2 ≠ 0.3).

import type { Prisma } from '../../prisma/generated/prisma/client.js'

export type EstadoDeuda = 'PENDIENTE' | 'PARCIAL' | 'PAGADO'

export interface PagoParaDeuda {
  estado:        string
  montoOriginal: unknown
  descuento:     unknown
  montoPagado:   unknown
}

export interface Deuda {
  montoOriginal: number   // Bs.
  descuento:     number   // Bs. (suma de todos los abonos)
  pagado:        number   // Bs. (suma de todos los abonos)
  saldo:         number   // Bs. lo que falta; 0 si está saldado
  estado:        EstadoDeuda
  abonos:        number   // cantidad de pagos reales (no anulados, con monto > 0)
}

export const aCentavos = (v: unknown): number => Math.round(Number(v) * 100)
const aBs = (centavos: number): number => centavos / 100

// `pagos` debe venir ordenado por id ascendente: el primer pago real fija el monto de
// referencia (el concepto pudo cambiar de precio después y no debe alterar deudas ya iniciadas).
export function calcularDeuda(montoConcepto: unknown, pagos: PagoParaDeuda[]): Deuda {
  const reales = pagos.filter(p => p.estado !== 'ANULADO' && aCentavos(p.montoPagado) > 0)
  const original  = aCentavos(reales.length ? reales[0].montoOriginal : montoConcepto)
  const descuento = reales.reduce((s, p) => s + aCentavos(p.descuento), 0)
  const pagado    = reales.reduce((s, p) => s + aCentavos(p.montoPagado), 0)
  const saldo     = original - descuento - pagado

  const estado: EstadoDeuda =
    reales.length === 0 ? 'PENDIENTE' : saldo <= 0 ? 'PAGADO' : 'PARCIAL'

  return {
    montoOriginal: aBs(original), descuento: aBs(descuento), pagado: aBs(pagado),
    saldo: aBs(Math.max(saldo, 0)), estado, abonos: reales.length,
  }
}

// Recalcula y guarda el estado de los pagos reales de la deuda. Llamar DENTRO de la
// transacción que tiene el candado de pagos. Los pagos "marcador" (monto 0, p. ej. una
// fila PENDIENTE sembrada) no se tocan.
export async function recalcularEstadosDeuda(
  tx: Prisma.TransactionClient,
  inscripcionId: number,
  conceptoPagoId: number,
  montoConcepto: unknown,
): Promise<Deuda> {
  const pagos = await tx.pago.findMany({
    where:   { inscripcionId, conceptoPagoId, estado: { not: 'ANULADO' } },
    orderBy: { id: 'asc' },
    select:  { estado: true, montoOriginal: true, descuento: true, montoPagado: true },
  })
  const deuda = calcularDeuda(montoConcepto, pagos)

  if (deuda.abonos > 0) {
    await tx.pago.updateMany({
      where: { inscripcionId, conceptoPagoId, estado: { not: 'ANULADO' }, montoPagado: { gt: 0 } },
      data:  { estado: deuda.estado === 'PAGADO' ? 'PAGADO' : 'PARCIAL' },
    })
  }
  return deuda
}