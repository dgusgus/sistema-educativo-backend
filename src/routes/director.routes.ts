import { Router } from 'express'
import {
  getDirectores,
  getDirectorActivo,
  getDirectorById,
  createDirectorConCuenta,
  updateDirector,
  asignarCuentaDirector,
} from '../controllers/director.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)

// IMPORTANTE: /activo debe ir ANTES de /:id
router.get('/activo',      requireRol('DIRECTOR', 'SECRETARIA'), getDirectorActivo)
router.get('/',            requireRol('DIRECTOR'),               getDirectores)
router.get('/:id',         requireRol('DIRECTOR'),               getDirectorById)
router.post('/con-cuenta', requireRol('DIRECTOR'),               createDirectorConCuenta)
router.put('/:id',         requireRol('DIRECTOR'),               updateDirector)
router.put('/:id/cuenta',  requireRol('DIRECTOR'),               asignarCuentaDirector)

export default router