import { Router } from 'express'
import { getInstitucion, updateInstitucion } from '../controllers/institucion.controller.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()

// Cualquier usuario autenticado puede ver los datos del colegio
router.get('/', getInstitucion)

// Solo el Director puede actualizar
router.put('/', requireRol('DIRECTOR'), updateInstitucion)

export default router