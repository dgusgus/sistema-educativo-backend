import { Router } from 'express'
import {
  getConceptosPago,
  createConceptoPago,
  getPagosByInscripcion,
  registrarPago,
  anularPago,
} from '../controllers/pago.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

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