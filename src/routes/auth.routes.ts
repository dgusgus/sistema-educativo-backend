import { Router } from 'express'
import { login, me, cambiarPassword } from '../controllers/auth.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { validar } from '../middlewares/validate.middleware.js'
import { loginSchema, cambiarPasswordSchema } from '../schemas/auth.schema.js'

const router = Router()

// Público — no requiere token
router.post('/login', validar({ body: loginSchema }), login)

// Protegidos — requiere token JWT
router.get('/me', authMiddleware, me)
router.put('/password', authMiddleware, validar({ body: cambiarPasswordSchema }), cambiarPassword)

export default router
