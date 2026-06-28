import { Router } from 'express'
import {
  getSecretarias,
  getSecretariaById,
  createSecretariaConCuenta,
  updateSecretaria,
  asignarCuentaSecretaria,
} from '../controllers/secretaria.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

router.get('/',            requireRol('DIRECTOR'),               getSecretarias)
router.get('/:id',         requireRol('DIRECTOR'),               getSecretariaById)
router.post('/con-cuenta', requireRol('DIRECTOR'),               createSecretariaConCuenta)
router.put('/:id',         requireRol('DIRECTOR'),               updateSecretaria)
router.put('/:id/cuenta',  requireRol('DIRECTOR'),               asignarCuentaSecretaria)

export default router