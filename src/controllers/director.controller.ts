import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'

const directorInclude = {
  persona:   true,
  usuario:   { select: { id: true, username: true, activo: true, roles: true } },
  gestiones: { select: { id: true, anio: true, activa: true } },
} as const

// ─── GET /api/directores ──────────────────────────────────────────────────────
export const getDirectores = async (_req: Request, res: Response): Promise<void> => {
  try {
    const directores = await prisma.director.findMany({
      include:  directorInclude,
      orderBy: { persona: { apellido: 'asc' } },
    })
    res.status(200).json(directores.map(aplanarPersona))
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
      where: {
        activo:    true,
        gestiones: { some: { activa: true } },
      },
      include: {
        persona: true,
        usuario: { select: { id: true, username: true } },
        gestiones: {
          where:  { activa: true },
          select: { id: true, anio: true },
        },
      },
    })

    if (!director) {
      res.status(404).json({ error: 'No hay director asignado a la gestión activa' })
      return
    }

    res.status(200).json(aplanarPersona(director))
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
      where:   { id },
      include: directorInclude,
    })

    if (!director) {
      res.status(404).json({ error: 'Director no encontrado' })
      return
    }

    res.status(200).json(aplanarPersona(director))
  } catch (error) {
    console.error('[director.getDirectorById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/directores/con-cuenta ─────────────────────────────────────────
// Crea la Persona + el perfil Director + su cuenta de acceso en una sola
// transacción. En v6, Director.usuarioId es OBLIGATORIO (no nullable) —
// un Director siempre nace con cuenta, no existe un "director sin cuenta".
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

    // Si se especifica gestionId, verificar que esa gestión no tenga director ya
    if (gestionId) {
      const gestionConDirector = await prisma.gestion.findUnique({
        where:  { id: gestionId },
        select: { directorId: true, director: { select: { persona: { select: { nombre: true, apellido: true } } } } },
      })
      if (gestionConDirector?.directorId) {
        res.status(409).json({
          error: `La gestión ya tiene un director asignado: ${gestionConDirector.director?.persona.nombre} ${gestionConDirector.director?.persona.apellido}`,
        })
        return
      }
    }

    const resultado = await prisma.$transaction(async tx => {
      const usuario = await tx.usuario.create({
        data: {
          username,
          passwordHash: await bcrypt.hash(password, 12),
          roles:  ['DIRECTOR'],
          activo: true,
        },
      })

      const personaCreada = await crearPersona(tx, persona)

      const director = await tx.director.create({
        data: { personaId: personaCreada.id, usuarioId: usuario.id },
        include: {
          persona: true,
          usuario: { select: { id: true, username: true, roles: true } },
        },
      })

      if (gestionId) {
        await tx.gestion.update({ where: { id: gestionId }, data: { directorId: director.id } })
      }

      return director
    })

    res.status(201).json({
      director: aplanarPersona(resultado),
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
  const { nombre, apellido, telefono, email, activo } = req.body as {
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    activo?: boolean
  }

  try {
    const existe = await prisma.director.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Director no encontrado' })
      return
    }

    // nombre/apellido/telefono/email viven en Persona, no en Director
    if (nombre !== undefined || apellido !== undefined || telefono !== undefined || email !== undefined) {
      await prisma.persona.update({
        where: { id: existe.personaId },
        data: {
          ...(nombre   !== undefined && { nombre }),
          ...(apellido !== undefined && { apellido }),
          ...(telefono !== undefined && { telefono }),
          ...(email    !== undefined && { email }),
        },
      })
    }

    const director = await prisma.director.update({
      where: { id },
      data: {
        ...(activo !== undefined && { activo }),
      },
      include: {
        persona:   true,
        gestiones: { select: { id: true, anio: true, activa: true } },
      },
    })

    res.status(200).json(aplanarPersona(director))
  } catch (error) {
    console.error('[director.updateDirector]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/directores/:id/cuenta ──────────────────────────────────────────
// Reasigna el director a OTRA cuenta ya existente con rol DIRECTOR.
// (Ya no crea cuentas nuevas acá — Director.usuarioId es obligatorio
// desde el nacimiento del registro, así que "asignar cuando falta" no
// es un caso posible en v6. Para eso, usa createDirectorConCuenta.)
export const asignarCuentaDirector = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { usuarioId } = req.body as { usuarioId?: number }

  if (!usuarioId) {
    res.status(400).json({ error: 'usuarioId es obligatorio' })
    return
  }

  try {
    const director = await prisma.director.findUnique({ where: { id } })
    if (!director) {
      res.status(404).json({ error: 'Director no encontrado' })
      return
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }
    if (!usuario.roles.includes('DIRECTOR')) {
      res.status(400).json({ error: 'El usuario no tiene el rol DIRECTOR' })
      return
    }
    const yaVinculado = await prisma.director.findFirst({ where: { usuarioId } })
    if (yaVinculado && yaVinculado.id !== id) {
      res.status(409).json({ error: 'Este usuario ya está vinculado a otro director' })
      return
    }

    const actualizado = await prisma.director.update({
      where: { id },
      data:  { usuarioId },
      include: {
        persona: true,
        usuario: { select: { id: true, username: true, roles: true } },
      },
    })

    res.status(200).json({
      director: aplanarPersona(actualizado),
      mensaje:  'Cuenta reasignada correctamente',
    })
  } catch (error) {
    console.error('[director.asignarCuentaDirector]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}