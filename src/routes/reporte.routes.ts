import { Router } from 'express'
import {
  getDashboard,
  getReporteAcademico,
  getReporteAcademicoPDF,
} from '../controllers/reporte.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// Dashboard — solo Director
router.get(
  '/dashboard',
  requireRol('DIRECTOR'),
  getDashboard
)

// Reporte académico JSON
router.get(
  '/reportes/academico',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getReporteAcademico
)

// Reporte académico PDF
router.get(
  '/reportes/academico/pdf',
  requireRol('DIRECTOR', 'SECRETARIA'),
  getReporteAcademicoPDF
)

export default router