import { Router } from 'express'
import {
  getUsuarios,
  getUsuarioById,
  createUsuario,
  updateUsuario,
  resetearPassword,
  deleteUsuario,
  vincularPerfil,
  createUsuarioConPerfil,
} from '../controllers/usuario.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// Listar y ver usuarios
router.get(
  '/',
  requireRol('DIRECTOR'),
  getUsuarios
)

// IMPORTANTE: /con-perfil debe ir ANTES de /:id
router.post(
  '/con-perfil',
  requireRol('DIRECTOR', 'SECRETARIA'),
  createUsuarioConPerfil
)

router.get(
  '/:id',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'),
  getUsuarioById
)

// Crear usuario
// Director → cualquier rol
// Secretaria → solo ESTUDIANTE y TUTOR (validado en el controller)
router.post(
  '/',
  requireRol('DIRECTOR', 'SECRETARIA'),
  createUsuario
)

// Editar rol o estado activo
router.put(
  '/:id',
  requireRol('DIRECTOR'),
  updateUsuario
)

// Resetear contraseña (sin conocer la actual)
router.put(
  '/:id/resetear',
  requireRol('DIRECTOR', 'SECRETARIA'),
  resetearPassword
)

// Vincular usuario a un perfil existente
router.put(
  '/:id/vincular',
  requireRol('DIRECTOR', 'SECRETARIA'),
  vincularPerfil
)

// Eliminar cuenta (conserva el perfil de la persona)
router.delete(
  '/:id',
  requireRol('DIRECTOR'),
  deleteUsuario
)

export default router