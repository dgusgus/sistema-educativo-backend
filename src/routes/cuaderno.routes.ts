import { Router } from 'express'
import { descargarCuadernoExcel, descargarCuadernoGestionExcel } from '../controllers/cuaderno.controller.js'
import { requireRol } from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'

const router = Router()

// Un :cursoId / :trimestreId que no sea entero positivo responde 400 (no un 500 de Prisma)
router.param('cursoId', paramEntero)
router.param('trimestreId', paramEntero)

router.get(
  '/:cursoId/trimestre/:trimestreId/excel',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  descargarCuadernoExcel,
)

router.get(
  '/:cursoId/gestion/excel',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  descargarCuadernoGestionExcel,
)

export default router
