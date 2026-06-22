import { Router } from 'express'
import {
  getEstudiantes,
  getEstudianteById,
  createEstudiante,
  updateEstudiante,
  inscribirEstudiante,
  getInscripcion,
  registrarResultado,
} from '../controllers/estudiante.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()

router.use(authMiddleware)

// Estudiantes
router.get(
  '/',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getEstudiantes
)
router.get(
  '/:id',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'),
  getEstudianteById
)
router.post(
  '/',
  requireRol('SECRETARIA', 'DIRECTOR'),
  createEstudiante
)
router.put(
  '/:id',
  requireRol('SECRETARIA', 'DIRECTOR'),
  updateEstudiante
)

export default router