import { Router } from 'express'
import {
  getCalificaciones,
  updateCalificacion,
  cerrarTrimestre,
  getCalificacionesEstudiante,
  getHistorialCalificacion,
} from '../controllers/calificacion.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)

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