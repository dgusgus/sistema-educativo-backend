import { Router } from 'express'
import {
  getDashboard,
  getReporteAcademico,
  getReporteAcademicoPDF,
  getReporteComparativo,
} from '../controllers/reporte.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()

// Dashboard — solo Director
router.get(
  '/dashboard',
  requireRol('DIRECTOR'),
  getDashboard
)

// Comparativo entre gestiones
router.get('/reportes/comparativo', requireRol('DIRECTOR', 'SECRETARIA'), getReporteComparativo)

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