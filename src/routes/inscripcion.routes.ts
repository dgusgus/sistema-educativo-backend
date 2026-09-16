// src/routes/inscripcion.routes.ts
import { Router } from 'express'
import {
  inscribirEstudiante,
  getInscripcion,
  registrarResultado,
  cambiarEstadoInscripcion,
  eliminarInscripcion,
} from '../controllers/estudiante.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()

router.use(authMiddleware)

router.post(
  '/',
  requireRol('SECRETARIA', 'DIRECTOR'),
  inscribirEstudiante
)
router.get(
  '/:id',
  requireRol('SECRETARIA', 'DIRECTOR'),
  getInscripcion
)
router.post(
  '/:id/resultado',
  requireRol('SECRETARIA', 'DIRECTOR'),
  registrarResultado
)

router.put(
  '/:id/estado',
  requireRol('SECRETARIA', 'DIRECTOR'),
  cambiarEstadoInscripcion
)

// "Desinscribir" — deshacer un error antes de que haya actividad real
// (ver comentario en estudiante.controller.ts → eliminarInscripcion)
router.delete(
  '/:id',
  requireRol('SECRETARIA', 'DIRECTOR'),
  eliminarInscripcion
)

export default router