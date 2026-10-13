// src/routes/actividad.routes.ts
import { Router } from 'express'
import {
  getActividades, getActividadById,
  createActividad, updateActividad, deleteActividad,
} from '../controllers/actividad.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)
router.get('/',     requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getActividades)
router.get('/:id',  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getActividadById)
router.post('/',    requireRol('DOCENTE'), createActividad)
router.put('/:id',  requireRol('DOCENTE'), updateActividad)
router.delete('/:id', requireRol('DOCENTE', 'DIRECTOR'), deleteActividad)
export default router