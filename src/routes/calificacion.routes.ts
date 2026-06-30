import { Router } from 'express'
import {
  getCalificaciones,
  registrarCalificaciones,
  updateCalificacion,
  cerrarTrimestre,
  getCalificacionesEstudiante,
  getHistorialCalificacion,
} from '../controllers/calificacion.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// Planilla del docente
router.get(
  '/',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  getCalificaciones
)
router.post(
  '/',
  requireRol('DOCENTE'),
  registrarCalificaciones
)
router.put(
  '/:id',
  requireRol('DOCENTE'),
  updateCalificacion
)

// Consulta del estudiante y tutor
router.get(
  '/estudiante',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'),
  getCalificacionesEstudiante
)

router.get(
  '/:id/historial',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getHistorialCalificacion
)

export default router