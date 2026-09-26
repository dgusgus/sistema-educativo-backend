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
  plantillaDocentes,
} from '../controllers/docente.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { uploadExcel }    from '../middlewares/upload.middleware.js'

const router = Router()
router.use(authMiddleware)

// ⚠️ específicas ANTES de /:id — Express matchea en orden, si /plantilla
// va después la captura getDocenteById como id="plantilla" (NaN → 500)
router.get('/export',  requireRol('DIRECTOR'), exportDocentes)
router.get('/plantilla', requireRol('DIRECTOR'), plantillaDocentes)
router.post('/import', requireRol('DIRECTOR'), uploadExcel, importDocentes)

router.get('/', requireRol('DIRECTOR'), getDocentes)
router.get('/mis-cursos', requireRol('DOCENTE'), getMisCursos)
router.get('/:id', requireRol('DIRECTOR'), getDocenteById)
router.post('/', requireRol('DIRECTOR'), createDocente)
router.put('/:id', requireRol('DIRECTOR'), updateDocente)
router.post('/:id/asignacion', requireRol('DIRECTOR'), asignarMateriaCurso)
router.delete('/:id/asignacion/:asignacionId', requireRol('DIRECTOR'), removeAsignacion)

export default router