import { Router } from 'express'
import {
  getEstudiantes,
  getEstudianteById,
  createEstudiante,
  updateEstudiante,
  inscribirEstudiante,
  getHistorialEstudiante,
  getInscripcion,
  registrarResultado,
  importEstudiantes,
  exportEstudiantes,
  plantillaEstudiantes,
} from '../controllers/estudiante.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { uploadExcel } from '../middlewares/upload.middleware.js'
import { paramEntero, validar } from '../middlewares/validate.middleware.js'
import { listarEstudiantesQuerySchema } from '../schemas/persona.schema.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)


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
  validar({ query: listarEstudiantesQuerySchema }),
  getEstudiantes
)
// Específica antes de /:id
router.get(
  '/:id/historial',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getHistorialEstudiante
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