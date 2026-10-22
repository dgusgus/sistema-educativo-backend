import { Router } from 'express'
import { getInstitucion, updateInstitucion } from '../controllers/institucion.controller.js'
import { requireRol } from '../middlewares/rbac.middleware.js'
import { validar } from '../middlewares/validate.middleware.js'
import { actualizarInstitucionSchema } from '../schemas/institucion.schema.js'

const router = Router()

// Cualquier usuario autenticado puede ver los datos del colegio
router.get('/', getInstitucion)

// Solo el Director puede actualizar
router.put('/', requireRol('DIRECTOR'), validar({ body: actualizarInstitucionSchema }), updateInstitucion)

export default router
