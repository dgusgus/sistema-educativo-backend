import { Router } from 'express'
import {
  getAsistencia,
  registrarAsistencia,
  actualizarAsistencia,
  getHistorial,
  getResumen,
  getReporteCurso,
} from '../controllers/asistencia.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('cursoId', paramEntero)
router.param('id', paramEntero)
router.param('inscripcionId', paramEntero)


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