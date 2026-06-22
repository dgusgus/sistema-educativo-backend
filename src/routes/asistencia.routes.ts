import { Router } from 'express'
import {
  getAsistencia,
  registrarAsistencia,
  actualizarAsistencia,
  getHistorial,
  getResumen,
  getReporteCurso,
} from '../controllers/asistencia.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()

router.use(authMiddleware)

// Docente registra y consulta
router.get(
  '/',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  getAsistencia
)
router.post(
  '/',
  requireRol('DOCENTE'),
  registrarAsistencia
)
router.put(
  '/:id',
  requireRol('DOCENTE', 'SECRETARIA', 'DIRECTOR'),
  actualizarAsistencia
)

// Historial — todos los roles con lógica RBAC interna
router.get(
  '/historial',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'),
  getHistorial
)

// Resumen % por materia — estudiante y tutor incluidos
router.get(
  '/resumen/:inscripcionId',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'),
  getResumen
)

// Reporte consolidado del curso — solo director y secretaria
router.get(
  '/reporte/:cursoId',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getReporteCurso
)

export default router