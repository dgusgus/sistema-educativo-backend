import { Router } from 'express'
import {
  getEstudiantes,
  getEstudianteById,
  createEstudiante,
  updateEstudiante,
  inscribirEstudiante,
  getInscripcion,
  registrarResultado,
  importEstudiantes,
  exportEstudiantes,
  plantillaEstudiantes,
} from '../controllers/estudiante.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { uploadExcel } from '../middlewares/upload.middleware.js'

const router = Router()

router.use(authMiddleware)

// ⚠️ específicas ANTES de /:id — Express matchea en orden, si /plantilla,
// /export o /import van después las captura getEstudianteById como
// id="plantilla" (NaN → Prisma 500)
router.get(
  '/export',
  requireRol('DIRECTOR', 'SECRETARIA'),
  exportEstudiantes
)
router.get('/plantilla', requireRol('DIRECTOR', 'SECRETARIA'), plantillaEstudiantes)
router.post(
  '/import',
  requireRol('DIRECTOR', 'SECRETARIA'),
  uploadExcel,
  importEstudiantes
)

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