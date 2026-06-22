// src/routes/materia.routes.ts
import { Router } from 'express'
import { getMaterias, getMateriaById, createMateria, updateMateria, deleteMateria } from '../controllers/materia.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)
router.get('/',     requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getMaterias)
router.get('/:id',  requireRol('DIRECTOR', 'SECRETARIA'), getMateriaById)
router.post('/',    requireRol('DIRECTOR', 'SECRETARIA'), createMateria)
router.put('/:id',  requireRol('DIRECTOR', 'SECRETARIA'), updateMateria)
router.delete('/:id', requireRol('DIRECTOR'), deleteMateria)
export default router