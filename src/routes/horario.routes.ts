// src/routes/horario.routes.ts
import { Router } from 'express'
import { getHorarios, createHorario, updateHorario, deleteHorario } from '../controllers/horario.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// Consulta: todos los roles — el RBAC fino (qué curso/docente puede ver
// cada uno) vive dentro del controller, igual que en asistencia/calificacion.
router.get('/', requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'), getHorarios)

// Escritura: solo Director y Secretaria (HU-12)
router.post('/',      requireRol('DIRECTOR', 'SECRETARIA'), createHorario)
router.put('/:id',    requireRol('DIRECTOR', 'SECRETARIA'), updateHorario)
router.delete('/:id', requireRol('DIRECTOR', 'SECRETARIA'), deleteHorario)

export default router