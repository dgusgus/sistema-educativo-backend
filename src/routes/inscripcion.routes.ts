// src/routes/inscripcion.routes.ts
import { Router } from 'express'
import {
  inscribirEstudiante,
  getInscripcion,
  registrarResultado,
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

export default router