// src/routes/curso.routes.ts
import { Router } from 'express'
import { getCursos, getCursoById, createCurso, updateCurso, deleteCurso } from '../controllers/curso.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)
router.get('/',     requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getCursos)
router.get('/:id',  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getCursoById)
router.post('/',    requireRol('DIRECTOR', 'SECRETARIA'), createCurso)
router.put('/:id',  requireRol('DIRECTOR', 'SECRETARIA'), updateCurso)
router.delete('/:id', requireRol('DIRECTOR'), deleteCurso)
export default router