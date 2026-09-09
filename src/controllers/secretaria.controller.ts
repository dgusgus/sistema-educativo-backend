import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'

const secretariaInclude = {
  persona: true,
  usuario: { select: { id: true, username: true, activo: true, roles: true } },
} as const

// ─── GET /api/secretarias ─────────────────────────────────────────────────────
export const getSecretarias = async (_req: Request, res: Response): Promise<void> => {
  try {
    const secretarias = await prisma.secretaria.findMany({
      include: secretariaInclude,
      orderBy: { persona: { apellido: 'asc' } },
    })
    res.status(200).json(secretarias.map(aplanarPersona))
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
      where:   { id },
      include: secretariaInclude,
    })

    if (!secretaria) {
      res.status(404).json({ error: 'Secretaria no encontrada' })
      return
    }

    res.status(200).json(aplanarPersona(secretaria))
  } catch (error) {
    console.error('[secretaria.getSecretariaById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/secretarias/con-cuenta ────────────────────────────────────────
// Secretaria.usuarioId también es obligatorio en v6 — igual que Director,
// siempre nace con cuenta.
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

  const persona: PersonaInput = { ci: ci ?? '', nombre: nombre ?? '', apellido: apellido ?? '', telefono, email }
  const errorPersona = validarPersona(persona)
  if (errorPersona || !username || !password) {
    res.status(400).json({
      error: errorPersona ?? 'ci, nombre, apellido, username y password son obligatorios',
    })
    return
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
    return
  }

  try {
    const ciExiste   = await buscarPersonaPorCi(persona.ci)
    const userExiste = await prisma.usuario.findUnique({ where: { username } })

    if (ciExiste) {
      res.status(409).json({ error: `Ya existe una persona registrada con el CI ${persona.ci}` })
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
          roles:  ['SECRETARIA'],
          activo: true,
        },
      })

      const personaCreada = await crearPersona(tx, persona)

      const secretaria = await tx.secretaria.create({
        data: { personaId: personaCreada.id, usuarioId: usuario.id },
        include: {
          persona: true,
          usuario: { select: { id: true, username: true, roles: true } },
        },
      })

      return secretaria
    })

    res.status(201).json({
      secretaria: aplanarPersona(resultado),
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
  const { ci, nombre, apellido, telefono, email, activo } = req.body as {
    ci?: string
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

    // ✅ CI editable — con chequeo de unicidad excluyendo al propio registro
    if (ci !== undefined) {
      const otraPersona = await buscarPersonaPorCi(ci)
      if (otraPersona && otraPersona.id !== existe.personaId) {
        res.status(409).json({ error: `Ya existe una persona registrada con el CI ${ci}` })
        return
      }
    }

    if (ci !== undefined || nombre !== undefined || apellido !== undefined || telefono !== undefined || email !== undefined) {
      await prisma.persona.update({
        where: { id: existe.personaId },
        data: {
          ...(ci       !== undefined && { ci }),
          ...(nombre   !== undefined && { nombre }),
          ...(apellido !== undefined && { apellido }),
          ...(telefono !== undefined && { telefono }),
          ...(email    !== undefined && { email }),
        },
      })
    }

    const secretaria = await prisma.secretaria.update({
      where: { id },
      data:  { ...(activo !== undefined && { activo }) },
      include: { persona: true },
    })

    res.status(200).json(aplanarPersona(secretaria))
  } catch (error) {
    console.error('[secretaria.updateSecretaria]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/secretarias/:id/cuenta ─────────────────────────────────────────
// Reasigna la secretaria a otra cuenta ya existente con rol SECRETARIA
// (ver nota equivalente en director.controller.ts).
export const asignarCuentaSecretaria = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { usuarioId } = req.body as { usuarioId?: number }

  if (!usuarioId) {
    res.status(400).json({ error: 'usuarioId es obligatorio' })
    return
  }

  try {
    const secretaria = await prisma.secretaria.findUnique({ where: { id } })
    if (!secretaria) {
      res.status(404).json({ error: 'Secretaria no encontrada' })
      return
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }
    if (!usuario.roles.includes('SECRETARIA')) {
      res.status(400).json({ error: 'El usuario no tiene el rol SECRETARIA' })
      return
    }
    const yaVinculada = await prisma.secretaria.findFirst({ where: { usuarioId } })
    if (yaVinculada && yaVinculada.id !== id) {
      res.status(409).json({ error: 'Este usuario ya está vinculado a otra secretaria' })
      return
    }

    const actualizada = await prisma.secretaria.update({
      where: { id },
      data:  { usuarioId },
      include: { persona: true, usuario: { select: { id: true, username: true, roles: true } } },
    })

    res.status(200).json({
      secretaria: aplanarPersona(actualizada),
      mensaje:    'Cuenta reasignada correctamente',
    })
  } catch (error) {
    console.error('[secretaria.asignarCuentaSecretaria]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}