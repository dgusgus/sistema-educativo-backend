// src/schemas/pago.schema.ts
import { z } from 'zod'
import { booleano, decimal, entero, enumES, fecha, id, opcional, textoOpc, textoReq } from './common.schema.js'

// Dinero: Decimal(10,2) → máximo 99 999 999.99
const dinero = decimal(0, 99_999_999.99, { minExclusivo: true })

export const createConceptoPagoSchema = z.object({
  nombre:           textoReq(150),
  descripcion:      textoOpc(500),
  monto:            dinero,
  obligatorio:      booleano.optional(),
  gestionId:        id,
  fechaVencimiento: opcional(fecha),
  periodicidad:     opcional(enumES(['UNICO', 'MENSUAL', 'TRIMESTRAL'])),
  trimestreId:      opcional(id),
})

// Editar un concepto: todo opcional. activo=false lo retira sin borrar los pagos ya hechos.
export const actualizarConceptoPagoSchema = z.object({
  nombre:           opcional(textoReq(150)),
  descripcion:      textoOpc(500),
  monto:            opcional(dinero),
  obligatorio:      opcional(booleano),
  activo:           opcional(booleano),
  fechaVencimiento: z.union([fecha, z.literal(''), z.null()]).optional(),
  trimestreId:      z.union([id, z.literal(''), z.null()]).optional(),
})

// Generador de cuotas: "Pensión" de febrero a noviembre, o una cuota por trimestre.
export const generarConceptosSchema = z.object({
  gestionId:   id,
  tipo:        enumES(['MENSUAL', 'TRIMESTRAL']),
  nombreBase:  textoReq(100),
  monto:       dinero,
  obligatorio: opcional(booleano),
  // MENSUAL
  mesDesde:        opcional(entero(1, 12)),
  mesHasta:        opcional(entero(1, 12)),
  diaVencimiento:  opcional(entero(1, 31)),
  // TRIMESTRAL: días después de iniciar el trimestre
  diasPlazo:       opcional(entero(0, 120)),
})

// ── Control de cobranza (consultas) ──
export const filtroCobranzaSchema = z.object({
  gestionId:   opcional(id),
  trimestreId: opcional(id),
  cursoId:     opcional(id),
  conceptoId:  opcional(id),
})

export const filtroPagosRecibidosSchema = z.object({
  gestionId:       opcional(id),
  cursoId:         opcional(id),
  conceptoId:      opcional(id),
  metodo:          opcional(enumES(['EFECTIVO', 'TRANSFERENCIA', 'QR'])),
  desde:           opcional(fecha),
  hasta:           opcional(fecha),
  incluirAnulados: opcional(booleano),
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