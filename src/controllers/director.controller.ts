import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'

// ─── GET /api/directores ──────────────────────────────────────────────────────
export const getDirectores = async (_req: Request, res: Response): Promise<void> => {
  try {
    const directores = await prisma.director.findMany({
      include: {
        usuario: { select: { id: true, username: true, activo: true } },
        gestion: { select: { id: true, anio: true, activa: true } },
      },
      orderBy: { apellido: 'asc' },
    })
    res.status(200).json(directores)
  } catch (error) {
    console.error('[director.getDirectores]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/directores/activo ───────────────────────────────────────────────
// Retorna el director de la gestión activa — útil para los boletines
export const getDirectorActivo = async (_req: Request, res: Response): Promise<void> => {
  try {
    const director = await prisma.director.findFirst({
      where: { gestion: { activa: true }, activo: true },
      include: {
        usuario: { select: { id: true, username: true } },
        gestion: { select: { id: true, anio: true } },
      },
    })

    if (!director) {
      res.status(404).json({ error: 'No hay director asignado a la gestión activa' })
      return
    }

    res.status(200).json(director)
  } catch (error) {
    console.error('[director.getDirectorActivo]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/directores/:id ──────────────────────────────────────────────────
export const getDirectorById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const director = await prisma.director.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, username: true, activo: true } },
        gestion: { select: { id: true, anio: true, activa: true } },
      },
    })

    if (!director) {
      res.status(404).json({ error: 'Director no encontrado' })
      return
    }

    res.status(200).json(director)
  } catch (error) {
    console.error('[director.getDirectorById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/directores/con-cuenta ─────────────────────────────────────────
// Crea el perfil del director + su cuenta de acceso en una sola transacción
export const createDirectorConCuenta = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, telefono, email, gestionId, username, password } =
    req.body as {
      ci?: string
      nombre?: string
      apellido?: string
      telefono?: string
      email?: string
      gestionId?: number
      username?: string
      password?: string
    }

  if (!ci || !nombre || !apellido || !username || !password) {
    res.status(400).json({
      error: 'ci, nombre, apellido, username y password son obligatorios',
    })
    return
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
    return
  }

  try {
    // Verificar duplicados
    const ciExiste   = await prisma.director.findUnique({ where: { ci } })
    const userExiste = await prisma.usuario.findUnique({ where: { username } })

    if (ciExiste) {
      res.status(409).json({ error: `Ya existe un director con el CI ${ci}` })
      return
    }
    if (userExiste) {
      res.status(409).json({ error: `El username "${username}" ya está en uso` })
      return
    }

    // Si se especifica gestionId, verificar que no tenga otro director ya asignado
    if (gestionId) {
      const gestionConDirector = await prisma.director.findFirst({
        where: { gestionId },
      })
      if (gestionConDirector) {
        res.status(409).json({
          error: `La gestión ya tiene un director asignado: ${gestionConDirector.nombre} ${gestionConDirector.apellido}`,
        })
        return
      }
    }

    // Crear usuario + director en una sola transacción
    const resultado = await prisma.$transaction(async tx => {
      const usuario = await tx.usuario.create({
        data: {
          username,
          passwordHash: await bcrypt.hash(password, 12),
          rol:    'DIRECTOR',
          activo: true,
        },
      })

      const director = await tx.director.create({
        data: { ci, nombre, apellido, telefono, email, gestionId, usuarioId: usuario.id },
        include: {
          usuario: { select: { id: true, username: true, rol: true } },
          gestion: { select: { id: true, anio: true } },
        },
      })

      return { director, usuario }
    })

    res.status(201).json({
      director: resultado.director,
      credenciales: {
        username,
        password,
        nota: 'Comparte estas credenciales de forma segura con el director',
      },
    })
  } catch (error) {
    console.error('[director.createDirectorConCuenta]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/directores/:id ──────────────────────────────────────────────────
export const updateDirector = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, apellido, telefono, email, activo, gestionId } = req.body as {
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    activo?: boolean
    gestionId?: number
  }

  try {
    const existe = await prisma.director.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Director no encontrado' })
      return
    }

    // Si se quiere cambiar la gestión, verificar que no tenga otro director
    if (gestionId && gestionId !== existe.gestionId) {
      const ocupada = await prisma.director.findFirst({
        where: { gestionId, id: { not: id } },
      })
      if (ocupada) {
        res.status(409).json({
          error: `La gestión ya tiene asignado a ${ocupada.nombre} ${ocupada.apellido}`,
        })
        return
      }
    }

    const director = await prisma.director.update({
      where: { id },
      data: {
        ...(nombre    !== undefined && { nombre }),
        ...(apellido  !== undefined && { apellido }),
        ...(telefono  !== undefined && { telefono }),
        ...(email     !== undefined && { email }),
        ...(activo    !== undefined && { activo }),
        ...(gestionId !== undefined && { gestionId }),
      },
      include: {
        gestion: { select: { id: true, anio: true } },
      },
    })

    res.status(200).json(director)
  } catch (error) {
    console.error('[director.updateDirector]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/directores/:id/cuenta ──────────────────────────────────────────
// Asigna o crea una cuenta para un director que ya existe sin cuenta
export const asignarCuentaDirector = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { usuarioId, username, password } = req.body as {
    usuarioId?: number
    username?: string
    password?: string
  }

  try {
    const director = await prisma.director.findUnique({ where: { id } })
    if (!director) {
      res.status(404).json({ error: 'Director no encontrado' })
      return
    }

    if (director.usuarioId) {
      res.status(409).json({
        error: 'Este director ya tiene una cuenta asignada',
        usuarioId: director.usuarioId,
      })
      return
    }

    let idUsuarioFinal: number

    if (usuarioId) {
      // Vincular a usuario existente
      const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } })
      if (!usuario) {
        res.status(404).json({ error: 'Usuario no encontrado' })
        return
      }
      if (usuario.rol !== 'DIRECTOR') {
        res.status(400).json({ error: `El usuario tiene rol "${usuario.rol}" — debe ser DIRECTOR` })
        return
      }
      const yaVinculado = await prisma.director.findFirst({ where: { usuarioId } })
      if (yaVinculado) {
        res.status(409).json({
          error: `Este usuario ya está vinculado a ${yaVinculado.nombre} ${yaVinculado.apellido}`,
        })
        return
      }
      idUsuarioFinal = usuarioId

    } else if (username && password) {
      // Crear usuario nuevo
      if (password.length < 6) {
        res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
        return
      }
      const userExiste = await prisma.usuario.findUnique({ where: { username } })
      if (userExiste) {
        res.status(409).json({ error: `El username "${username}" ya está en uso` })
        return
      }
      const nuevoUsuario = await prisma.usuario.create({
        data: {
          username,
          passwordHash: await bcrypt.hash(password, 12),
          rol:    'DIRECTOR',
          activo: true,
        },
      })
      idUsuarioFinal = nuevoUsuario.id

    } else {
      res.status(400).json({
        error: 'Envía "usuarioId" para vincular uno existente, o "username" + "password" para crear uno nuevo',
      })
      return
    }

    const actualizado = await prisma.director.update({
      where: { id },
      data:  { usuarioId: idUsuarioFinal },
      include: { usuario: { select: { id: true, username: true, rol: true } } },
    })

    res.status(200).json({
      director: actualizado,
      mensaje:  'Cuenta asignada correctamente',
    })
  } catch (error) {
    console.error('[director.asignarCuentaDirector]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}