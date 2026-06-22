import { Router } from 'express'
import { login, me, cambiarPassword } from '../controllers/auth.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'

const router = Router()

// Público — no requiere token
router.post('/login', login)

// Protegidos — requiere token JWT
router.get('/me', authMiddleware, me)
router.put('/password', authMiddleware, cambiarPassword)

export default router