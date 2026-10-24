import { Router } from 'express'
import {
  getConceptosPago,
  createConceptoPago,
  getPagosByInscripcion,
  registrarPago,
  anularPago,
  getReciboPago,
} from '../controllers/pago.controller.js'
import {
  getCobranza, getPagosRecibidos, descargarCobranzaExcel, actualizarConcepto, generarConceptos,
} from '../controllers/cobranza.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero, validar } from '../middlewares/validate.middleware.js'
import {
  createConceptoPagoSchema, actualizarConceptoPagoSchema, generarConceptosSchema,
  filtroCobranzaSchema, filtroPagosRecibidosSchema,
} from '../schemas/pago.schema.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)
router.param('inscripcionId', paramEntero)

// ── Control de cobranza ── (ANTES de '/:inscripcionId', que si no se tragaría la palabra "cobranza")
router.get('/cobranza',            requireRol('DIRECTOR', 'SECRETARIA'), validar({ query: filtroCobranzaSchema }), getCobranza)
router.get('/cobranza/recibidos',  requireRol('DIRECTOR', 'SECRETARIA'), validar({ query: filtroPagosRecibidosSchema }), getPagosRecibidos)
router.get('/cobranza/excel',      requireRol('DIRECTOR', 'SECRETARIA'), validar({ query: filtroCobranzaSchema }), descargarCobranzaExcel)

// ── Conceptos ──
router.get(
  '/conceptos',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getConceptosPago
)
router.post(
  '/conceptos',
  requireRol('DIRECTOR'),
  validar({ body: createConceptoPagoSchema }),
  createConceptoPago
)
router.post(
  '/conceptos/generar',
  requireRol('DIRECTOR'),
  validar({ body: generarConceptosSchema }),
  generarConceptos
)
router.put(
  '/conceptos/:id',
  requireRol('DIRECTOR'),
  validar({ body: actualizarConceptoPagoSchema }),
  actualizarConcepto
)

// ── Cobro por estudiante ──
router.get(
  '/:inscripcionId',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getPagosByInscripcion
)
router.post(
  '/',
  requireRol('SECRETARIA', 'DIRECTOR'),
  registrarPago
)
router.get('/:id/recibo', requireRol('SECRETARIA', 'DIRECTOR'), getReciboPago)
router.put(
  '/:id/anular',
  requireRol('SECRETARIA', 'DIRECTOR'),
  anularPago
)

export default router