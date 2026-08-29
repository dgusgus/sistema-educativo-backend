import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'

// Selecciona los 5 perfiles posibles con su Persona — un usuario puede
// tener más de uno (roles: Rol[]), por eso ya no alcanza con un switch
// sobre un solo rol como antes.
const perfilesInclude = {
  director:   { include: { persona: { select: { id: true, nombre: true, apellido: true } } } },
  secretaria: { include: { persona: { select: { id: true, nombre: true, apellido: true } } } },
  docente:    { include: { persona: { select: { id: true, nombre: true, apellido: true } } } },
  estudiante: { include: { persona: { select: { id: true, nombre: true, apellido: true } } } },
  tutor:      { include: { persona: { select: { id: true, nombre: true, apellido: true } } } },
} as const

// El nombre para mostrar sale del primer perfil que exista, en este
// orden de prioridad. Con Persona compartida, da igual cuál perfil se
// use — el nombre/apellido es el mismo en todos.
function primerPerfil(usuario: {
  director: any; secretaria: any; docente: any; estudiante: any; tutor: any
}) {
  return usuario.director ?? usuario.secretaria ?? usuario.docente
      ?? usuario.estudiante ?? usuario.tutor ?? null
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as {
    username?: string
    password?: string
  }

  if (!username || !password) {
    res.status(400).json({ error: 'Usuario y contraseña son obligatorios' })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { username },
      include: perfilesInclude,
    })

    if (!usuario) {
      res.status(401).json({ error: 'Credenciales incorrectas' })
      return
    }

    if (!usuario.activo) {
      res.status(401).json({ error: 'Cuenta desactivada. Contacte al administrador.' })
      return
    }

    const passwordValida = await bcrypt.compare(password, usuario.passwordHash)
    if (!passwordValida) {
      res.status(401).json({ error: 'Credenciales incorrectas' })
      return
    }

    const perfil = primerPerfil(usuario)
    const nombre = perfil
      ? `${perfil.persona.nombre} ${perfil.persona.apellido}`
      : usuario.username

    const token = jwt.sign(
      {
        id:       usuario.id,
        roles:    usuario.roles,
        username: usuario.username,
        nombre,
      },
      process.env.JWT_SECRET ?? 'secret',
      { expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as SignOptions['expiresIn'] }
    )

    res.status(200).json({
      token,
      usuario: {
        id:       usuario.id,
        username: usuario.username,
        roles:    usuario.roles,     // ← antes "rol" (uno solo)
        nombre,                      // ← el frontend lo usa en el sidebar
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
        roles:    true,
        activo:   true,
        ...perfilesInclude,
      },
    })

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    // "perfiles": todos los perfiles que tenga vinculados (uno por rol),
    // aplanados para que se lea perfil.nombre en vez de perfil.persona.nombre.
    const perfiles = {
      director:   usuario.director   ? aplanarPersona(usuario.director)   : null,
      secretaria: usuario.secretaria ? aplanarPersona(usuario.secretaria) : null,
      docente:    usuario.docente    ? aplanarPersona(usuario.docente)    : null,
      estudiante: usuario.estudiante ? aplanarPersona(usuario.estudiante) : null,
      tutor:      usuario.tutor      ? aplanarPersona(usuario.tutor)      : null,
    }
    const perfil = primerPerfil(usuario)

    res.status(200).json({
      id:       usuario.id,
      username: usuario.username,
      roles:    usuario.roles,
      activo:   usuario.activo,
      perfil:   perfil ? aplanarPersona(perfil) : null,  // compat: el "principal"
      perfiles,                                           // todos los que tenga
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