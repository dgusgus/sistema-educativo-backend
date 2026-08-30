import { Router } from 'express'
import {
  getCalificaciones,
  updateCalificacion,
  cerrarTrimestre,
  getCalificacionesEstudiante,
  getHistorialCalificacion,
} from '../controllers/calificacion.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// Planilla del docente (ahora con promedio ya calculado por dimensión)
router.get(
  '/',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  getCalificaciones
)

// ⚠️ Ya NO hay POST '/' — antes el docente escribía la nota directo acá.
// Ahora se registra vía POST /api/actividades-evaluativas/:id/notas
// (evaluacion.routes.ts), que recalcula el promedio automáticamente.

// Corrección manual — solo funciona con el trimestre CERRADO (ver
// comentario en el controller)
router.put(
  '/:id',
  requireRol('DIRECTOR', 'SECRETARIA'),
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