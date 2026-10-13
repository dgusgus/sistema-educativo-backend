// src/routes/materia.routes.ts
import { Router } from 'express'
import { getMaterias, getMateriaById, createMateria, updateMateria, deleteMateria } from '../controllers/materia.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)
router.get('/',     requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getMaterias)
router.get('/:id',  requireRol('DIRECTOR', 'SECRETARIA'), getMateriaById)
router.post('/',    requireRol('DIRECTOR', 'SECRETARIA'), createMateria)
router.put('/:id',  requireRol('DIRECTOR', 'SECRETARIA'), updateMateria)
router.delete('/:id', requireRol('DIRECTOR'), deleteMateria)
export default router