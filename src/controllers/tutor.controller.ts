import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'

// GET /api/tutores
export const getTutores = async (req: Request, res: Response): Promise<void> => {
  const { search } = req.query as { search?: string }

  try {
    const tutores = await prisma.tutor.findMany({
      where: search
        ? {
            persona: {
              OR: [
                { nombre:   { contains: search, mode: 'insensitive' } },
                { apellido: { contains: search, mode: 'insensitive' } },
                { ci:       { contains: search } },
              ],
            },
          }
        : undefined,
      include: {
        persona: true,
        estudiantes: {
          include: {
            estudiante: {
              select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } },
            },
          },
        },
        usuario: { select: { id: true, username: true, activo: true } },
      },
      orderBy: { persona: { apellido: 'asc' } },
    })

    res.status(200).json(tutores.map(t => ({
      ...aplanarPersona(t),
      estudiantes: t.estudiantes.map(e => ({
        ...e,
        estudiante: { id: e.estudiante.id, ...e.estudiante.persona },
      })),
    })))
  } catch (error) {
    console.error('[tutor.getTutores]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/tutores/:id
export const getTutorById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const tutor = await prisma.tutor.findUnique({
      where: { id },
      include: {
        persona: true,
        estudiantes: {
          include: {
            estudiante: {
              include: {
                persona: { select: { nombre: true, apellido: true, ci: true } },
                inscripciones: {
                  include: { curso: true, gestion: true },
                  orderBy: { gestion: { anio: 'desc' } },
                  take: 1,
                },
              },
            },
          },
        },
        usuario: { select: { id: true, username: true, activo: true } },
      },
    })
    if (!tutor) {
      res.status(404).json({ error: 'Tutor no encontrado' })
      return
    }
    res.status(200).json({
      ...aplanarPersona(tutor),
      estudiantes: tutor.estudiantes.map(e => ({
        ...e,
        estudiante: aplanarPersona(e.estudiante),
      })),
    })
  } catch (error) {
    console.error('[tutor.getTutorById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/tutores
export const createTutor = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, telefono, email, ocupacion, gradoInstruccion } = req.body as {
    ci?: string
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    ocupacion?: string
    gradoInstruccion?: string
  }
  // ⚠️ "parentesco" ya NO va acá — ahora vive en TutorEstudiante (el
  // parentesco es respecto a CADA estudiante, no un atributo del tutor).
  // Se registra al vincular: POST /api/tutores/:id/vincular/:estudianteId

  const persona: PersonaInput = { ci: ci ?? '', nombre: nombre ?? '', apellido: apellido ?? '', telefono, email }
  const errorPersona = validarPersona(persona)
  if (errorPersona) {
    res.status(400).json({ error: errorPersona })
    return
  }

  try {
    const existe = await buscarPersonaPorCi(persona.ci)
    if (existe) {
      res.status(409).json({ error: `Ya existe una persona registrada con el CI ${persona.ci}` })
      return
    }

    const tutor = await prisma.$transaction(async tx => {
      const personaCreada = await crearPersona(tx, persona)
      return tx.tutor.create({
        data:    { personaId: personaCreada.id, ocupacion, gradoInstruccion },
        include: { persona: true },
      })
    })

    res.status(201).json(aplanarPersona(tutor))
  } catch (error) {
    console.error('[tutor.createTutor]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/tutores/:id
export const updateTutor = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, apellido, telefono, email, ocupacion, gradoInstruccion } = req.body as {
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    ocupacion?: string
    gradoInstruccion?: string
  }

  try {
    const existe = await prisma.tutor.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Tutor no encontrado' })
      return
    }

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

    const tutor = await prisma.tutor.update({
      where: { id },
      data: {
        ...(ocupacion        !== undefined && { ocupacion }),
        ...(gradoInstruccion !== undefined && { gradoInstruccion }),
      },
      include: { persona: true },
    })

    res.status(200).json(aplanarPersona(tutor))
  } catch (error) {
    console.error('[tutor.updateTutor]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/tutores/:id/vincular/:estudianteId
// Acá SÍ va el parentesco — es un dato de la relación, no del tutor.
export const vincularEstudiante = async (req: Request, res: Response): Promise<void> => {
  const tutorId      = Number(req.params.id)
  const estudianteId = Number(req.params.estudianteId)
  const { parentesco, esTutorPrincipal, esApoderado, viveConEstudiante } = req.body as {
    parentesco?: string
    esTutorPrincipal?: boolean
    esApoderado?: boolean
    viveConEstudiante?: boolean
  }

  if (!parentesco) {
    res.status(400).json({ error: 'parentesco es obligatorio' })
    return
  }

  try {
    const existe = await prisma.tutorEstudiante.findUnique({
      where: { tutorId_estudianteId: { tutorId, estudianteId } },
    })
    if (existe) {
      res.status(409).json({ error: 'El tutor ya está vinculado a este estudiante' })
      return
    }

    const vinculo = await prisma.tutorEstudiante.create({
      data: {
        tutorId, estudianteId, parentesco: parentesco as any,
        esTutorPrincipal:  esTutorPrincipal  ?? false,
        esApoderado:       esApoderado       ?? false,
        viveConEstudiante: viveConEstudiante ?? true,
      },
      include: {
        tutor:      { select: { persona: { select: { nombre: true, apellido: true } } } },
        estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } },
      },
    })
    res.status(201).json({ message: 'Vinculación creada', vinculo })
  } catch (error) {
    console.error('[tutor.vincularEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// DELETE /api/tutores/:id/vincular/:estudianteId
export const desvincularEstudiante = async (req: Request, res: Response): Promise<void> => {
  const tutorId      = Number(req.params.id)
  const estudianteId = Number(req.params.estudianteId)

  try {
    await prisma.tutorEstudiante.delete({
      where: { tutorId_estudianteId: { tutorId, estudianteId } },
    })
    res.status(200).json({ message: 'Vinculación eliminada correctamente' })
  } catch (error) {
    console.error('[tutor.desvincularEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}