import { Router } from 'express'
import {
  getDocentes,
  getDocenteById,
  createDocente,
  updateDocente,
  asignarMateriaCurso,
  removeAsignacion,
  getMisCursos,
  importDocentes,
  exportDocentes,
} from '../controllers/docente.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { uploadExcel } from '../middlewares/upload.middleware.js'



const router = Router()

// Todos requieren autenticación
router.use(authMiddleware)

router.get('/export', requireRol('DIRECTOR'), exportDocentes)
router.post('/import', requireRol('DIRECTOR'), uploadExcel, importDocentes)
// Solo Director
router.get('/', requireRol('DIRECTOR'), getDocentes)
router.get('/mis-cursos', requireRol('DOCENTE'), getMisCursos)
router.get('/:id', requireRol('DIRECTOR'), getDocenteById)
router.post('/', requireRol('DIRECTOR'), createDocente)
router.put('/:id', requireRol('DIRECTOR'), updateDocente)
router.post('/:id/asignacion', requireRol('DIRECTOR'), asignarMateriaCurso)
router.delete('/:id/asignacion/:asignacionId', requireRol('DIRECTOR'), removeAsignacion)

export default router