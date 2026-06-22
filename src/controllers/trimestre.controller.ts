import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// GET /api/trimestres
export const getTrimestres = async (req: Request, res: Response): Promise<void> => {
  const { gestionId } = req.query as { gestionId?: string }

  try {
    const trimestres = await prisma.trimestre.findMany({
      where: gestionId
        ? { gestionId: Number(gestionId) }
        : { gestion: { activa: true } },
      include: {
        gestion: { select: { id: true, anio: true } },
        _count:  { select: { calificaciones: true } },
      },
      orderBy: { numero: 'asc' },
    })
    res.status(200).json(trimestres)
  } catch (error) {
    console.error('[trimestre.getTrimestres]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/trimestres/:id
export const getTrimestreById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const trimestre = await prisma.trimestre.findUnique({
      where: { id },
      include: {
        gestion: { select: { id: true, anio: true } },
        _count:  { select: { calificaciones: true, resumenAsistencias: true } },
      },
    })
    if (!trimestre) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }
    res.status(200).json(trimestre)
  } catch (error) {
    console.error('[trimestre.getTrimestreById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/trimestres
export const createTrimestre = async (req: Request, res: Response): Promise<void> => {
  const { numero, nombre, fechaInicio, fechaFin, gestionId } = req.body as {
    numero?: number
    nombre?: string
    fechaInicio?: string
    fechaFin?: string
    gestionId?: number
  }

  if (!numero || !nombre || !gestionId) {
    res.status(400).json({ error: 'numero, nombre y gestionId son obligatorios' })
    return
  }

  if (![1, 2, 3].includes(numero)) {
    res.status(400).json({ error: 'numero debe ser 1, 2 o 3' })
    return
  }

  try {
    const existe = await prisma.trimestre.findUnique({
      where: { numero_gestionId: { numero, gestionId } },
    })
    if (existe) {
      res.status(409).json({ error: `Ya existe el trimestre ${numero} en esta gestión` })
      return
    }

    const trimestre = await prisma.trimestre.create({
      data: {
        numero,
        nombre,
        gestionId,
        fechaInicio: fechaInicio ? new Date(fechaInicio) : undefined,
        fechaFin:    fechaFin    ? new Date(fechaFin)    : undefined,
      },
    })
    res.status(201).json(trimestre)
  } catch (error) {
    console.error('[trimestre.createTrimestre]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/trimestres/:id
export const updateTrimestre = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, fechaInicio, fechaFin } = req.body as {
    nombre?: string
    fechaInicio?: string
    fechaFin?: string
  }

  try {
    const existe = await prisma.trimestre.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }
    if (existe.cerrado) {
      res.status(400).json({ error: 'No se puede editar un trimestre cerrado' })
      return
    }

    const trimestre = await prisma.trimestre.update({
      where: { id },
      data: {
        ...(nombre      !== undefined && { nombre }),
        ...(fechaInicio !== undefined && { fechaInicio: new Date(fechaInicio) }),
        ...(fechaFin    !== undefined && { fechaFin:    new Date(fechaFin) }),
      },
    })
    res.status(200).json(trimestre)
  } catch (error) {
    console.error('[trimestre.updateTrimestre]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/trimestres/:id/cerrar  (ya existía — lo mantenemos en calificacion.controller.ts)
export { cerrarTrimestre } from './calificacion.controller.js'