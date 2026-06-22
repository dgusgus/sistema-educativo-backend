import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// GET /api/actividades
export const getActividades = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, desde, hasta } = req.query as {
    docenteMateriaCursoId?: string
    desde?: string
    hasta?: string
  }

  if (!docenteMateriaCursoId) {
    res.status(400).json({ error: 'docenteMateriaCursoId es obligatorio' })
    return
  }

  try {
    const actividades = await prisma.actividad.findMany({
      where: {
        docenteMateriaCursoId: Number(docenteMateriaCursoId),
        ...(desde || hasta ? {
          fecha: {
            ...(desde && { gte: new Date(desde) }),
            ...(hasta && { lte: new Date(hasta) }),
          },
        } : {}),
      },
      include: {
        docenteMateriaCurso: {
          include: {
            materia: { select: { nombre: true } },
            curso:   { select: { nombre: true } },
          },
        },
      },
      orderBy: { fecha: 'desc' },
    })
    res.status(200).json(actividades)
  } catch (error) {
    console.error('[actividad.getActividades]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/actividades/:id
export const getActividadById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const actividad = await prisma.actividad.findUnique({
      where: { id },
      include: {
        docenteMateriaCurso: {
          include: {
            materia: true,
            curso:   true,
            docente: { select: { nombre: true, apellido: true } },
          },
        },
      },
    })
    if (!actividad) {
      res.status(404).json({ error: 'Actividad no encontrada' })
      return
    }
    res.status(200).json(actividad)
  } catch (error) {
    console.error('[actividad.getActividadById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/actividades
export const createActividad = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, fecha, tema, descripcion, tareaAsignada } = req.body as {
    docenteMateriaCursoId?: number
    fecha?: string
    tema?: string
    descripcion?: string
    tareaAsignada?: string
  }

  if (!docenteMateriaCursoId || !tema) {
    res.status(400).json({ error: 'docenteMateriaCursoId y tema son obligatorios' })
    return
  }

  try {
    // Verificar acceso del docente
    if (req.user?.rol === 'DOCENTE') {
      const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user.id } })
      const asig = await prisma.docenteMateriaCurso.findFirst({
        where: { id: docenteMateriaCursoId, docenteId: docente?.id },
      })
      if (!asig) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    const actividad = await prisma.actividad.create({
      data: {
        docenteMateriaCursoId,
        fecha:         fecha ? new Date(fecha) : new Date(),
        tema,
        descripcion,
        tareaAsignada,
      },
    })
    res.status(201).json(actividad)
  } catch (error) {
    console.error('[actividad.createActividad]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/actividades/:id
export const updateActividad = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { tema, descripcion, tareaAsignada } = req.body as {
    tema?: string
    descripcion?: string
    tareaAsignada?: string
  }

  try {
    const existe = await prisma.actividad.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Actividad no encontrada' })
      return
    }

    const actividad = await prisma.actividad.update({
      where: { id },
      data: {
        ...(tema          !== undefined && { tema }),
        ...(descripcion   !== undefined && { descripcion }),
        ...(tareaAsignada !== undefined && { tareaAsignada }),
      },
    })
    res.status(200).json(actividad)
  } catch (error) {
    console.error('[actividad.updateActividad]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// DELETE /api/actividades/:id
export const deleteActividad = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    await prisma.actividad.delete({ where: { id } })
    res.status(200).json({ message: 'Actividad eliminada correctamente' })
  } catch (error) {
    console.error('[actividad.deleteActividad]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}