import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as {
    username?: string
    password?: string
  }

  // Validar campos obligatorios
  if (!username || !password) {
    res.status(400).json({ error: 'Usuario y contraseña son obligatorios' })
    return
  }

  try {
    // Buscar usuario activo
    const usuario = await prisma.usuario.findUnique({
      where: { username },
      include: {
        docente:    { select: { id: true, nombre: true, apellido: true } },
        estudiante: { select: { id: true, nombre: true, apellido: true } },
        tutor:      { select: { id: true, nombre: true, apellido: true } },
      },
    })

    // Usuario no existe
    if (!usuario) {
      res.status(401).json({ error: 'Credenciales incorrectas' })
      return
    }

    // Usuario inactivo
    if (!usuario.activo) {
      res.status(401).json({ error: 'Cuenta desactivada. Contacte al administrador.' })
      return
    }

    // Verificar contraseña
    const passwordValida = await bcrypt.compare(password, usuario.passwordHash)
    if (!passwordValida) {
      res.status(401).json({ error: 'Credenciales incorrectas' })
      return
    }

    // Obtener nombre según el rol
    const perfil =
      usuario.docente ??
      usuario.estudiante ??
      usuario.tutor ??
      null

    const nombre = perfil
      ? `${perfil.nombre} ${perfil.apellido}`
      : usuario.username

    // Generar token JWT
    const token = jwt.sign(
      {
        id:       usuario.id,
        rol:      usuario.rol,
        username: usuario.username,
      },
      process.env.JWT_SECRET ?? 'secret',
      { expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as SignOptions['expiresIn'], }
    )

    res.status(200).json({
      token,
      usuario: {
        id:       usuario.id,
        username: usuario.username,
        rol:      usuario.rol,
        nombre,
      },
    })
  } catch (error) {
    console.error('[auth.login]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Retorna los datos del usuario autenticado (requiere token)
export const me = async (req: Request, res: Response): Promise<void> => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.id },
      select: {
        id:       true,
        username: true,
        rol:      true,
        activo:   true,
        docente:    { select: { id: true, nombre: true, apellido: true, especialidad: true } },
        estudiante: { select: { id: true, nombre: true, apellido: true } },
        tutor:      { select: { id: true, nombre: true, apellido: true } },
      },
    })

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    const perfil =
      usuario.docente ??
      usuario.estudiante ??
      usuario.tutor ??
      null

    res.status(200).json({
      id:       usuario.id,
      username: usuario.username,
      rol:      usuario.rol,
      activo:   usuario.activo,
      perfil,
    })
  } catch (error) {
    console.error('[auth.me]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/auth/password ───────────────────────────────────────────────────
// Cambiar contraseña del usuario autenticado
export const cambiarPassword = async (req: Request, res: Response): Promise<void> => {
  const { passwordActual, passwordNueva } = req.body as {
    passwordActual?: string
    passwordNueva?: string
  }

  if (!passwordActual || !passwordNueva) {
    res.status(400).json({ error: 'Contraseña actual y nueva son obligatorias' })
    return
  }

  if (passwordNueva.length < 8) {
    res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.id },
    })

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    const passwordValida = await bcrypt.compare(passwordActual, usuario.passwordHash)
    if (!passwordValida) {
      res.status(400).json({ error: 'La contraseña actual es incorrecta' })
      return
    }

    const nuevoHash = await bcrypt.hash(passwordNueva, 12)

    await prisma.usuario.update({
      where: { id: req.user!.id },
      data:  { passwordHash: nuevoHash },
    })

    res.status(200).json({ message: 'Contraseña actualizada correctamente' })
  } catch (error) {
    console.error('[auth.cambiarPassword]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}