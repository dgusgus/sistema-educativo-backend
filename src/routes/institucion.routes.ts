import { Router } from 'express'
import { getInstitucion, updateInstitucion } from '../controllers/institucion.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// Cualquier usuario autenticado puede ver los datos del colegio
router.get('/', getInstitucion)

// Solo el Director puede actualizar
router.put('/', requireRol('DIRECTOR'), updateInstitucion)

export default router