// src/schemas/pago.schema.ts
import { z } from 'zod'
import { booleano, decimal, enumES, fecha, id, opcional, textoOpc, textoReq } from './common.schema.js'

// Dinero: Decimal(10,2) → máximo 99 999 999.99
const dinero = decimal(0, 99_999_999.99, { minExclusivo: true })

export const createConceptoPagoSchema = z.object({
  nombre:           textoReq(150),
  descripcion:      textoOpc(500),
  monto:            dinero,
  obligatorio:      booleano.optional(),
  gestionId:        id,
  fechaVencimiento: opcional(fecha),
})

export const registrarPagoSchema = z.object({
  inscripcionId:  id,
  conceptoPagoId: id,
  montoPagado:    dinero,
  descuento:      opcional(decimal(0, 99_999_999.99)),
  metodoPago:     opcional(enumES(['EFECTIVO', 'TRANSFERENCIA', 'QR'])),
  observaciones:  textoOpc(500),
})

export const anularPagoSchema = z.object({
  observaciones: textoOpc(500),
})