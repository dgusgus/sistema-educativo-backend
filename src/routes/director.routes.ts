import { Router } from 'express'
import {
  getDirectores,
  getDirectorActivo,
  getDirectorById,
  createDirectorConCuenta,
  updateDirector,
  asignarCuentaDirector,
} from '../controllers/director.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// IMPORTANTE: /activo debe ir ANTES de /:id
router.get('/activo',      requireRol('DIRECTOR', 'SECRETARIA'), getDirectorActivo)
router.get('/',            requireRol('DIRECTOR'),               getDirectores)
router.get('/:id',         requireRol('DIRECTOR'),               getDirectorById)
router.post('/con-cuenta', requireRol('DIRECTOR'),               createDirectorConCuenta)
router.put('/:id',         requireRol('DIRECTOR'),               updateDirector)
router.put('/:id/cuenta',  requireRol('DIRECTOR'),               asignarCuentaDirector)

export default router