// src/routes/tutor.routes.ts
import { Router } from 'express'
import {
  getTutores, getTutorById, createTutor, updateTutor,
  vincularEstudiante, desvincularEstudiante,
  importTutores, exportTutores
} from '../controllers/tutor.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { uploadExcel } from '../middlewares/upload.middleware.js'

const router = Router()
router.use(authMiddleware)
router.get('/',    requireRol('DIRECTOR', 'SECRETARIA'), getTutores)
router.get('/:id', requireRol('DIRECTOR', 'SECRETARIA'), getTutorById)
router.post('/',   requireRol('SECRETARIA', 'DIRECTOR'), createTutor)
router.put('/:id', requireRol('SECRETARIA', 'DIRECTOR'), updateTutor)
router.post('/:id/vincular/:estudianteId',  requireRol('SECRETARIA', 'DIRECTOR'), vincularEstudiante)
router.delete('/:id/vincular/:estudianteId', requireRol('SECRETARIA', 'DIRECTOR'), desvincularEstudiante)
router.get('/export', requireRol('DIRECTOR', 'SECRETARIA'), exportTutores)
router.post('/import', requireRol('DIRECTOR', 'SECRETARIA'), uploadExcel, importTutores)
export default router