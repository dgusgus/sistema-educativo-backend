// src/routes/trimestre.routes.ts (completo)
import { Router } from 'express'
import {
  getTrimestres, getTrimestreById,
  createTrimestre, updateTrimestre,
} from '../controllers/trimestre.controller.js'
import { cerrarTrimestre, getPendientesCierre } from '../controllers/calificacion.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)
router.get('/',            requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getTrimestres)
router.get('/:id',         requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getTrimestreById)
router.post('/',           requireRol('DIRECTOR', 'SECRETARIA'), createTrimestre)
router.put('/:id',         requireRol('DIRECTOR', 'SECRETARIA'), updateTrimestre)
router.post('/:id/cerrar', requireRol('DIRECTOR', 'SECRETARIA'), cerrarTrimestre)
// Qué falta para poder cerrar (solo lectura — no modifica nada)
router.get('/:id/pendientes', requireRol('DIRECTOR', 'SECRETARIA'), getPendientesCierre)
export default router