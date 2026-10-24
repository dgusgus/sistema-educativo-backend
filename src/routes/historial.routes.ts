import { Router } from 'express'
import { getHistorial, getHistorialPdf, getMiHistorial } from '../controllers/historial.controller.js'
import { requireRol } from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'

const router = Router()
router.param('estudianteId', paramEntero)

// Director/Secretaria: cualquier estudiante. Estudiante: solo el suyo. Tutor: sus vinculados
// (la pertenencia se valida dentro del controller con puedeVerEstudiante).
router.get('/mio', requireRol('ESTUDIANTE'), getMiHistorial)
router.get('/:estudianteId/pdf', requireRol('DIRECTOR', 'SECRETARIA', 'ESTUDIANTE', 'TUTOR'), getHistorialPdf)
router.get('/:estudianteId', requireRol('DIRECTOR', 'SECRETARIA', 'ESTUDIANTE', 'TUTOR'), getHistorial)

export default router