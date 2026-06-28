import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'

// ─── GET /api/secretarias ─────────────────────────────────────────────────────
export const getSecretarias = async (_req: Request, res: Response): Promise<void> => {
  try {
    const secretarias = await prisma.secretaria.findMany({
      include: {
        usuario: { select: { id: true, username: true, activo: true } },
      },
      orderBy: { apellido: 'asc' },
    })
    res.status(200).json(secretarias)
  } catch (error) {
    console.error('[secretaria.getSecretarias]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/secretarias/:id ─────────────────────────────────────────────────
export const getSecretariaById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const secretaria = await prisma.secretaria.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, username: true, activo: true } },
      },
    })

    if (!secretaria) {
      res.status(404).json({ error: 'Secretaria no encontrada' })
      return
    }

    res.status(200).json(secretaria)
  } catch (error) {
    console.error('[secretaria.getSecretariaById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/secretarias/con-cuenta ────────────────────────────────────────
export const createSecretariaConCuenta = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, telefono, email, username, password } =
    req.body as {
      ci?: string
      nombre?: string
      apellido?: string
      telefono?: string
      email?: string
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
    const ciExiste   = await prisma.secretaria.findUnique({ where: { ci } })
    const userExiste = await prisma.usuario.findUnique({ where: { username } })

    if (ciExiste) {
      res.status(409).json({ error: `Ya existe una secretaria con el CI ${ci}` })
      return
    }
    if (userExiste) {
      res.status(409).json({ error: `El username "${username}" ya está en uso` })
      return
    }

    const resultado = await prisma.$transaction(async tx => {
      const usuario = await tx.usuario.create({
        data: {
          username,
          passwordHash: await bcrypt.hash(password, 12),
          rol:    'SECRETARIA',
          activo: true,
        },
      })

      const secretaria = await tx.secretaria.create({
        data: { ci, nombre, apellido, telefono, email, usuarioId: usuario.id },
        include: {
          usuario: { select: { id: true, username: true, rol: true } },
        },
      })

      return { secretaria, usuario }
    })

    res.status(201).json({
      secretaria: resultado.secretaria,
      credenciales: {
        username,
        password,
        nota: 'Comparte estas credenciales de forma segura',
      },
    })
  } catch (error) {
    console.error('[secretaria.createSecretariaConCuenta]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/secretarias/:id ─────────────────────────────────────────────────
export const updateSecretaria = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, apellido, telefono, email, activo } = req.body as {
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    activo?: boolean
  }

  try {
    const existe = await prisma.secretaria.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Secretaria no encontrada' })
      return
    }

    const secretaria = await prisma.secretaria.update({
      where: { id },
      data: {
        ...(nombre   !== undefined && { nombre }),
        ...(apellido !== undefined && { apellido }),
        ...(telefono !== undefined && { telefono }),
        ...(email    !== undefined && { email }),
        ...(activo   !== undefined && { activo }),
      },
    })

    res.status(200).json(secretaria)
  } catch (error) {
    console.error('[secretaria.updateSecretaria]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/secretarias/:id/cuenta ─────────────────────────────────────────
export const asignarCuentaSecretaria = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { usuarioId, username, password } = req.body as {
    usuarioId?: number
    username?: string
    password?: string
  }

  try {
    const secretaria = await prisma.secretaria.findUnique({ where: { id } })
    if (!secretaria) {
      res.status(404).json({ error: 'Secretaria no encontrada' })
      return
    }

    if (secretaria.usuarioId) {
      res.status(409).json({
        error: 'Esta secretaria ya tiene una cuenta asignada',
        usuarioId: secretaria.usuarioId,
      })
      return
    }

    let idUsuarioFinal: number

    if (usuarioId) {
      const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } })
      if (!usuario) {
        res.status(404).json({ error: 'Usuario no encontrado' })
        return
      }
      if (usuario.rol !== 'SECRETARIA') {
        res.status(400).json({ error: `El usuario tiene rol "${usuario.rol}" — debe ser SECRETARIA` })
        return
      }
      const yaVinculada = await prisma.secretaria.findFirst({ where: { usuarioId } })
      if (yaVinculada) {
        res.status(409).json({
          error: `Este usuario ya está vinculado a ${yaVinculada.nombre} ${yaVinculada.apellido}`,
        })
        return
      }
      idUsuarioFinal = usuarioId

    } else if (username && password) {
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
          rol:    'SECRETARIA',
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

    const actualizada = await prisma.secretaria.update({
      where: { id },
      data:  { usuarioId: idUsuarioFinal },
      include: { usuario: { select: { id: true, username: true, rol: true } } },
    })

    res.status(200).json({
      secretaria: actualizada,
      mensaje:    'Cuenta asignada correctamente',
    })
  } catch (error) {
    console.error('[secretaria.asignarCuentaSecretaria]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}