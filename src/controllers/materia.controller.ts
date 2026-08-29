import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { conNombre } from '../lib/curso.helper.js'

// GET /api/materias
export const getMaterias = async (_req: Request, res: Response): Promise<void> => {
  try {
    const materias = await prisma.materia.findMany({
      include: {
        campoSaber: { select: { id: true, nombre: true } },
        _count:     { select: { asignaciones: true } },
      },
      orderBy: { nombre: 'asc' },
    })
    res.status(200).json(materias)
  } catch (error) {
    console.error('[materia.getMaterias]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/materias/:id
export const getMateriaById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const materia = await prisma.materia.findUnique({
      where: { id },
      include: {
        campoSaber: true,
        asignaciones: {
          include: {
            docente: { select: { id: true, persona: { select: { nombre: true, apellido: true } } } },
            curso:   true,
            gestion: { select: { id: true, anio: true } },
          },
          orderBy: { gestion: { anio: 'desc' } },
        },
      },
    })
    if (!materia) {
      res.status(404).json({ error: 'Materia no encontrada' })
      return
    }
    res.status(200).json({
      ...materia,
      asignaciones: materia.asignaciones.map(a => ({
        ...a,
        docente: aplanarPersona(a.docente),
        curso:   conNombre(a.curso),
      })),
    })
  } catch (error) {
    console.error('[materia.getMateriaById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/materias
export const createMateria = async (req: Request, res: Response): Promise<void> => {
  const { nombre, codigo, horasSemanales, campoSaberId } = req.body as {
    nombre?: string
    codigo?: string
    horasSemanales?: number
    campoSaberId?: number
  }

  if (!nombre || !codigo) {
    res.status(400).json({ error: 'nombre y codigo son obligatorios' })
    return
  }

  try {
    const existe = await prisma.materia.findUnique({ where: { codigo } })
    if (existe) {
      res.status(409).json({ error: `Ya existe una materia con el código ${codigo}` })
      return
    }

    const materia = await prisma.materia.create({
      data: { nombre, codigo: codigo.toUpperCase(), horasSemanales: horasSemanales ?? 4, campoSaberId },
    })
    res.status(201).json(materia)
  } catch (error) {
    console.error('[materia.createMateria]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/materias/:id
export const updateMateria = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, horasSemanales, campoSaberId, activo } = req.body as {
    nombre?: string
    horasSemanales?: number
    campoSaberId?: number
    activo?: boolean
  }

  try {
    const existe = await prisma.materia.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Materia no encontrada' })
      return
    }

    const materia = await prisma.materia.update({
      where: { id },
      data: {
        ...(nombre         !== undefined && { nombre }),
        ...(horasSemanales !== undefined && { horasSemanales }),
        ...(campoSaberId   !== undefined && { campoSaberId }),
        ...(activo         !== undefined && { activo }),
      },
    })
    res.status(200).json(materia)
  } catch (error) {
    console.error('[materia.updateMateria]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// DELETE /api/materias/:id
export const deleteMateria = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const asignaciones = await prisma.docenteMateriaCurso.count({ where: { materiaId: id } })
    if (asignaciones > 0) {
      res.status(400).json({
        error: `No se puede eliminar — la materia tiene ${asignaciones} asignaciones activas`,
      })
      return
    }

    await prisma.materia.delete({ where: { id } })
    res.status(200).json({ message: 'Materia eliminada correctamente' })
  } catch (error) {
    console.error('[materia.deleteMateria]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}