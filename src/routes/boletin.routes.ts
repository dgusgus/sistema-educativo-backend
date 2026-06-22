import { Router } from 'express'
import { generarBoletin, generarBoletinesCurso } from '../controllers/boletin.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// Boletín individual
router.get(
  '/:estudianteId/:trimestreId',
  requireRol('DIRECTOR', 'SECRETARIA', 'ESTUDIANTE', 'TUTOR'),
  generarBoletin
)

// Boletines masivos del curso
router.get(
  '/curso/:cursoId/:trimestreId',
  requireRol('DIRECTOR', 'SECRETARIA'),
  generarBoletinesCurso
)

export default router