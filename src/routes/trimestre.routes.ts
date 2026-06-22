// src/routes/trimestre.routes.ts (completo)
import { Router } from 'express'
import {
  getTrimestres, getTrimestreById,
  createTrimestre, updateTrimestre,
} from '../controllers/trimestre.controller.js'
import { cerrarTrimestre } from '../controllers/calificacion.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)
router.get('/',            requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getTrimestres)
router.get('/:id',         requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getTrimestreById)
router.post('/',           requireRol('DIRECTOR', 'SECRETARIA'), createTrimestre)
router.put('/:id',         requireRol('DIRECTOR', 'SECRETARIA'), updateTrimestre)
router.post('/:id/cerrar', requireRol('DIRECTOR', 'SECRETARIA'), cerrarTrimestre)
export default router