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
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)

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