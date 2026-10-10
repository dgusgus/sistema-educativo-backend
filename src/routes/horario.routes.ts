// src/routes/horario.routes.ts
import { Router } from 'express'
import { getHorarios, createHorario, updateHorario, deleteHorario } from '../controllers/horario.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)

// Consulta: todos los roles — el RBAC fino (qué curso/docente puede ver
// cada uno) vive dentro del controller, igual que en asistencia/calificacion.
router.get('/', requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'), getHorarios)

// Escritura: solo Director y Secretaria (HU-12)
router.post('/',      requireRol('DIRECTOR', 'SECRETARIA'), createHorario)
router.put('/:id',    requireRol('DIRECTOR', 'SECRETARIA'), updateHorario)
router.delete('/:id', requireRol('DIRECTOR', 'SECRETARIA'), deleteHorario)

export default router