// src/routes/trimestre.routes.ts (completo)
import { Router } from 'express'
import {
  getTrimestres, getTrimestreById,
  createTrimestre, updateTrimestre,
} from '../controllers/trimestre.controller.js'
import { cerrarTrimestre, getPendientesCierre } from '../controllers/calificacion.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)
router.get('/',            requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getTrimestres)
router.get('/:id',         requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getTrimestreById)
router.post('/',           requireRol('DIRECTOR', 'SECRETARIA'), createTrimestre)
router.put('/:id',         requireRol('DIRECTOR', 'SECRETARIA'), updateTrimestre)
router.post('/:id/cerrar', requireRol('DIRECTOR', 'SECRETARIA'), cerrarTrimestre)
// Qué falta para poder cerrar (solo lectura — no modifica nada)
router.get('/:id/pendientes', requireRol('DIRECTOR', 'SECRETARIA'), getPendientesCierre)
export default router