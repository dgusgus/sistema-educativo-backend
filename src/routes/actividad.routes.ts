// src/routes/actividad.routes.ts
import { Router } from 'express'
import {
  getActividades, getActividadById,
  createActividad, updateActividad, deleteActividad,
} from '../controllers/actividad.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)
router.get('/',     requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getActividades)
router.get('/:id',  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getActividadById)
router.post('/',    requireRol('DOCENTE'), createActividad)
router.put('/:id',  requireRol('DOCENTE'), updateActividad)
router.delete('/:id', requireRol('DOCENTE', 'DIRECTOR'), deleteActividad)
export default router