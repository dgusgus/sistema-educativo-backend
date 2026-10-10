import { Router } from 'express'
import {
  getConceptosPago,
  createConceptoPago,
  getPagosByInscripcion,
  registrarPago,
  anularPago,
} from '../controllers/pago.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)
router.param('inscripcionId', paramEntero)

router.get(
  '/conceptos',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getConceptosPago
)
router.post(
  '/conceptos',
  requireRol('DIRECTOR'),
  createConceptoPago
)
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
router.put(
  '/:id/anular',
  requireRol('SECRETARIA', 'DIRECTOR'),
  anularPago
)

export default router