import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// GET /api/gestiones
export const getGestiones = async (_req: Request, res: Response): Promise<void> => {
  try {
    const gestiones = await prisma.gestion.findMany({
      include: {
        _count: {
          select: { cursos: true, inscripciones: true, trimestres: true },
        },
      },
      orderBy: { anio: 'desc' },
    })
    res.status(200).json(gestiones)
  } catch (error) {
    console.error('[gestion.getGestiones]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/gestiones/activa
export const getGestionActiva = async (_req: Request, res: Response): Promise<void> => {
  try {
    const gestion = await prisma.gestion.findFirst({
      where: { activa: true },
      include: {
        cursos:     { orderBy: { nivel: 'asc' } },
        trimestres: { orderBy: { numero: 'asc' } },
        _count:     { select: { inscripciones: true } },
      },
    })
    if (!gestion) {
      res.status(404).json({ error: 'No hay gestión activa' })
      return
    }
    res.status(200).json(gestion)
  } catch (error) {
    console.error('[gestion.getGestionActiva]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/gestiones/:id
export const getGestionById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const gestion = await prisma.gestion.findUnique({
      where: { id },
      include: {
        cursos:        { orderBy: { nivel: 'asc' } },
        trimestres:    { orderBy: { numero: 'asc' } },
        conceptosPago: true,
        _count:        { select: { inscripciones: true, asignaciones: true } },
      },
    })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }
    res.status(200).json(gestion)
  } catch (error) {
    console.error('[gestion.getGestionById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/gestiones
export const createGestion = async (req: Request, res: Response): Promise<void> => {
  const { anio, descripcion, fechaInicio, fechaFin } = req.body as {
    anio?: number
    descripcion?: string
    fechaInicio?: string
    fechaFin?: string
  }

  if (!anio) {
    res.status(400).json({ error: 'El año es obligatorio' })
    return
  }

  try {
    const existe = await prisma.gestion.findUnique({ where: { anio } })
    if (existe) {
      res.status(409).json({ error: `Ya existe una gestión para el año ${anio}` })
      return
    }

    const gestion = await prisma.gestion.create({
      data: {
        anio,
        descripcion: descripcion ?? `Gestión Escolar ${anio}`,
        fechaInicio: fechaInicio ? new Date(fechaInicio) : undefined,
        fechaFin:    fechaFin    ? new Date(fechaFin)    : undefined,
      },
    })
    res.status(201).json(gestion)
  } catch (error) {
    console.error('[gestion.createGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/gestiones/:id
export const updateGestion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { descripcion, fechaInicio, fechaFin } = req.body as {
    descripcion?: string
    fechaInicio?: string
    fechaFin?: string
  }

  try {
    const existe = await prisma.gestion.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    const gestion = await prisma.gestion.update({
      where: { id },
      data: {
        ...(descripcion !== undefined && { descripcion }),
        ...(fechaInicio !== undefined && { fechaInicio: new Date(fechaInicio) }),
        ...(fechaFin    !== undefined && { fechaFin:    new Date(fechaFin) }),
      },
    })
    res.status(200).json(gestion)
  } catch (error) {
    console.error('[gestion.updateGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/gestiones/:id/activar
// Solo puede haber UNA gestión activa a la vez
export const activarGestion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    // Desactivar todas las demás
    await prisma.gestion.updateMany({
      where: { id: { not: id } },
      data:  { activa: false },
    })

    const actualizada = await prisma.gestion.update({
      where: { id },
      data:  { activa: true },
    })

    res.status(200).json({
      message: `Gestión ${actualizada.anio} activada correctamente`,
      gestion: actualizada,
    })
  } catch (error) {
    console.error('[gestion.activarGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}