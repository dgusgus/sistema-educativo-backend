// src/routes/gestion.routes.ts
import { Router } from 'express'
import {
  getGestiones, getGestionActiva, getGestionById,
  createGestion, updateGestion, activarGestion,
} from '../controllers/gestion.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)
router.get('/',          requireRol('DIRECTOR', 'SECRETARIA'), getGestiones)
router.get('/activa',    requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'), getGestionActiva)
router.get('/:id',       requireRol('DIRECTOR', 'SECRETARIA'), getGestionById)
router.post('/',         requireRol('DIRECTOR'), createGestion)
router.put('/:id',       requireRol('DIRECTOR'), updateGestion)
router.put('/:id/activar', requireRol('DIRECTOR'), activarGestion)
export default router