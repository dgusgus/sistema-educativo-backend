// src/routes/curso.routes.ts
import { Router } from 'express'
import { getCursos, getCursoById, createCurso, updateCurso, deleteCurso } from '../controllers/curso.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)
router.get('/',     requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getCursos)
router.get('/:id',  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getCursoById)
router.post('/',    requireRol('DIRECTOR', 'SECRETARIA'), createCurso)
router.put('/:id',  requireRol('DIRECTOR', 'SECRETARIA'), updateCurso)
router.delete('/:id', requireRol('DIRECTOR'), deleteCurso)
export default router