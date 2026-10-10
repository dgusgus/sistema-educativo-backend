// src/routes/inscripcion.routes.ts
import { Router } from 'express'
import {
  inscribirEstudiante,
  getInscripcion,
  registrarResultado,
  cambiarEstadoInscripcion,
  eliminarInscripcion,
} from '../controllers/estudiante.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)


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