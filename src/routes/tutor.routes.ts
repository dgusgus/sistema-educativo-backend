// src/routes/tutor.routes.ts
import { Router } from 'express'
import {
  getTutores, getTutorById, createTutor, updateTutor,
  vincularEstudiante, desvincularEstudiante,
  importTutores, exportTutores,
  plantillaTutores,
} from '../controllers/tutor.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { uploadExcel }    from '../middlewares/upload.middleware.js'

const router = Router()
router.use(authMiddleware)

// ⚠️ específicas ANTES de /:id — Express matchea en orden, si /plantilla
// va después la captura getTutorById como id="plantilla" (NaN → 500)
router.get('/export',  requireRol('DIRECTOR', 'SECRETARIA'), exportTutores)
router.get('/plantilla', requireRol('DIRECTOR', 'SECRETARIA'), plantillaTutores)
router.post('/import', requireRol('DIRECTOR', 'SECRETARIA'), uploadExcel, importTutores)

router.get('/',    requireRol('DIRECTOR', 'SECRETARIA'), getTutores)
router.get('/:id', requireRol('DIRECTOR', 'SECRETARIA'), getTutorById)
router.post('/',   requireRol('SECRETARIA', 'DIRECTOR'), createTutor)
router.put('/:id', requireRol('SECRETARIA', 'DIRECTOR'), updateTutor)
router.post('/:id/vincular/:estudianteId',  requireRol('SECRETARIA', 'DIRECTOR'), vincularEstudiante)
router.delete('/:id/vincular/:estudianteId', requireRol('SECRETARIA', 'DIRECTOR'), desvincularEstudiante)
export default router