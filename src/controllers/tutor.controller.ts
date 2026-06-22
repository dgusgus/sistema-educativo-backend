import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// GET /api/tutores
export const getTutores = async (req: Request, res: Response): Promise<void> => {
  const { search } = req.query as { search?: string }

  try {
    const tutores = await prisma.tutor.findMany({
      where: search ? {
        OR: [
          { nombre:   { contains: search, mode: 'insensitive' } },
          { apellido: { contains: search, mode: 'insensitive' } },
          { ci:       { contains: search } },
        ],
      } : undefined,
      include: {
        estudiantes: {
          include: {
            estudiante: { select: { id: true, nombre: true, apellido: true, ci: true } },
          },
        },
        usuario: { select: { id: true, username: true, activo: true } },
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    })
    res.status(200).json(tutores)
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
        estudiantes: {
          include: {
            estudiante: {
              include: {
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
    res.status(200).json(tutor)
  } catch (error) {
    console.error('[tutor.getTutorById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/tutores
export const createTutor = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, telefono, email, parentesco } = req.body as {
    ci?: string
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    parentesco?: string
  }

  if (!ci || !nombre || !apellido) {
    res.status(400).json({ error: 'ci, nombre y apellido son obligatorios' })
    return
  }

  try {
    const existe = await prisma.tutor.findUnique({ where: { ci } })
    if (existe) {
      res.status(409).json({ error: `Ya existe un tutor con el CI ${ci}` })
      return
    }

    const tutor = await prisma.tutor.create({
      data: { ci, nombre, apellido, telefono, email, parentesco },
    })
    res.status(201).json(tutor)
  } catch (error) {
    console.error('[tutor.createTutor]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/tutores/:id
export const updateTutor = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, apellido, telefono, email, parentesco } = req.body as {
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    parentesco?: string
  }

  try {
    const existe = await prisma.tutor.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Tutor no encontrado' })
      return
    }

    const tutor = await prisma.tutor.update({
      where: { id },
      data: {
        ...(nombre      !== undefined && { nombre }),
        ...(apellido    !== undefined && { apellido }),
        ...(telefono    !== undefined && { telefono }),
        ...(email       !== undefined && { email }),
        ...(parentesco  !== undefined && { parentesco }),
      },
    })
    res.status(200).json(tutor)
  } catch (error) {
    console.error('[tutor.updateTutor]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/tutores/:id/vincular/:estudianteId
export const vincularEstudiante = async (req: Request, res: Response): Promise<void> => {
  const tutorId      = Number(req.params.id)
  const estudianteId = Number(req.params.estudianteId)

  try {
    const existe = await prisma.tutorEstudiante.findUnique({
      where: { tutorId_estudianteId: { tutorId, estudianteId } },
    })
    if (existe) {
      res.status(409).json({ error: 'El tutor ya está vinculado a este estudiante' })
      return
    }

    const vinculo = await prisma.tutorEstudiante.create({
      data: { tutorId, estudianteId },
      include: {
        tutor:      { select: { nombre: true, apellido: true } },
        estudiante: { select: { nombre: true, apellido: true } },
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