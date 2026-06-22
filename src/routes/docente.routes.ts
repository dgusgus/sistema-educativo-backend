import { Router } from 'express'
import {
  getDocentes,
  getDocenteById,
  createDocente,
  updateDocente,
  asignarMateriaCurso,
  removeAsignacion,
} from '../controllers/docente.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()

// Todos requieren autenticación
router.use(authMiddleware)

// Solo Director
router.get('/', requireRol('DIRECTOR'), getDocentes)
router.get('/:id', requireRol('DIRECTOR'), getDocenteById)
router.post('/', requireRol('DIRECTOR'), createDocente)
router.put('/:id', requireRol('DIRECTOR'), updateDocente)
router.post('/:id/asignacion', requireRol('DIRECTOR'), asignarMateriaCurso)
router.delete('/:id/asignacion/:asignacionId', requireRol('DIRECTOR'), removeAsignacion)

export default router