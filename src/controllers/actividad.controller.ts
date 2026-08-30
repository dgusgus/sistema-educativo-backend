// src/controllers/actividad.controller.ts
//
// v6 renombró el modelo "Actividad" (tema/descripción/tarea del día de
// clase) a BitacoraClase, para distinguirlo de ActividadEvaluativa (lo
// evaluable, con nota — ver evaluacion.controller.ts). Este archivo
// conserva las mismas rutas/nombres de función que ya usan
// actividad.routes.ts, solo cambia el modelo de Prisma por debajo.

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
    const bitacoras = await prisma.bitacoraClase.findMany({
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
            curso:   { select: { nivel: true, grado: true, paralelo: true } },
          },
        },
        trimestre: { select: { id: true, numero: true, nombre: true } },
      },
      orderBy: { fecha: 'desc' },
    })
    res.status(200).json(bitacoras)
  } catch (error) {
    console.error('[actividad.getActividades]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/actividades/:id
export const getActividadById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const bitacora = await prisma.bitacoraClase.findUnique({
      where: { id },
      include: {
        docenteMateriaCurso: {
          include: {
            materia: true,
            curso:   true,
            docente: { select: { persona: { select: { nombre: true, apellido: true } } } },
          },
        },
        trimestre: { select: { id: true, numero: true, nombre: true } },
      },
    })
    if (!bitacora) {
      res.status(404).json({ error: 'Registro de clase no encontrado' })
      return
    }
    res.status(200).json(bitacora)
  } catch (error) {
    console.error('[actividad.getActividadById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/actividades
export const createActividad = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, trimestreId, fecha, tema, descripcion, tareaAsignada } = req.body as {
    docenteMateriaCursoId?: number
    trimestreId?: number
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
    if (req.user?.roles.includes('DOCENTE') && !req.user.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))) {
      const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user.id } })
      const asig = await prisma.docenteMateriaCurso.findFirst({
        where: { id: docenteMateriaCursoId, docenteId: docente?.id },
      })
      if (!asig) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    const bitacora = await prisma.bitacoraClase.create({
      data: {
        docenteMateriaCursoId,
        trimestreId,
        fecha: fecha ? new Date(fecha) : new Date(),
        tema,
        descripcion,
        tareaAsignada,
      },
    })
    res.status(201).json(bitacora)
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
    const existe = await prisma.bitacoraClase.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Registro de clase no encontrado' })
      return
    }

    const bitacora = await prisma.bitacoraClase.update({
      where: { id },
      data: {
        ...(tema          !== undefined && { tema }),
        ...(descripcion   !== undefined && { descripcion }),
        ...(tareaAsignada !== undefined && { tareaAsignada }),
      },
    })
    res.status(200).json(bitacora)
  } catch (error) {
    console.error('[actividad.updateActividad]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// DELETE /api/actividades/:id
export const deleteActividad = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    await prisma.bitacoraClase.delete({ where: { id } })
    res.status(200).json({ message: 'Registro de clase eliminado correctamente' })
  } catch (error) {
    console.error('[actividad.deleteActividad]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}