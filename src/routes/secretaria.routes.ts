import { Router } from 'express'
import {
  getSecretarias,
  getSecretariaById,
  createSecretariaConCuenta,
  updateSecretaria,
  asignarCuentaSecretaria,
} from '../controllers/secretaria.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)

router.get('/',            requireRol('DIRECTOR'),               getSecretarias)
router.get('/:id',         requireRol('DIRECTOR'),               getSecretariaById)
router.post('/con-cuenta', requireRol('DIRECTOR'),               createSecretariaConCuenta)
router.put('/:id',         requireRol('DIRECTOR'),               updateSecretaria)
router.put('/:id/cuenta',  requireRol('DIRECTOR'),               asignarCuentaSecretaria)

export default router