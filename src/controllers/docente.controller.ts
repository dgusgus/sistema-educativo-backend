import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// ─── GET /api/docentes ────────────────────────────────────────────────────────
export const getDocentes = async (req: Request, res: Response): Promise<void> => {
  const { activo, search } = req.query as {
    activo?: string
    search?: string
  }

  try {
    const docentes = await prisma.docente.findMany({
      where: {
        activo: activo === 'false' ? false : true,
        OR: search
          ? [
              { nombre:   { contains: search, mode: 'insensitive' } },
              { apellido: { contains: search, mode: 'insensitive' } },
              { ci:       { contains: search } },
            ]
          : undefined,
      },
      include: {
        usuario: {
          select: { id: true, username: true, activo: true },
        },
        asignaciones: {
          where: {
            gestion: { activa: true },
          },
          include: {
            materia: { select: { id: true, nombre: true, codigo: true } },
            curso:   { select: { id: true, nombre: true, nivel: true } },
          },
        },
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    })

    res.status(200).json(docentes)
  } catch (error) {
    console.error('[docente.getDocentes]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/docentes/:id ────────────────────────────────────────────────────
export const getDocenteById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const docente = await prisma.docente.findUnique({
      where: { id },
      include: {
        usuario: {
          select: { id: true, username: true, rol: true, activo: true },
        },
        asignaciones: {
          include: {
            materia: true,
            curso:   true,
            gestion: { select: { id: true, anio: true, activa: true } },
            horarios: true,
          },
          orderBy: { gestion: { anio: 'desc' } },
        },
      },
    })

    if (!docente) {
      res.status(404).json({ error: 'Docente no encontrado' })
      return
    }

    res.status(200).json(docente)
  } catch (error) {
    console.error('[docente.getDocenteById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/docentes ───────────────────────────────────────────────────────
export const createDocente = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, especialidad, telefono, email } = req.body as {
    ci?: string
    nombre?: string
    apellido?: string
    especialidad?: string
    telefono?: string
    email?: string
  }

  if (!ci || !nombre || !apellido) {
    res.status(400).json({ error: 'CI, nombre y apellido son obligatorios' })
    return
  }

  try {
    // Verificar CI duplicado
    const existe = await prisma.docente.findUnique({ where: { ci } })
    if (existe) {
      res.status(409).json({ error: `Ya existe un docente con el CI ${ci}` })
      return
    }

    const docente = await prisma.docente.create({
      data: { ci, nombre, apellido, especialidad, telefono, email },
    })

    res.status(201).json(docente)
  } catch (error) {
    console.error('[docente.createDocente]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/docentes/:id ────────────────────────────────────────────────────
export const updateDocente = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, apellido, especialidad, telefono, email, activo } = req.body as {
    nombre?: string
    apellido?: string
    especialidad?: string
    telefono?: string
    email?: string
    activo?: boolean
  }

  try {
    const existe = await prisma.docente.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Docente no encontrado' })
      return
    }

    const docente = await prisma.docente.update({
      where: { id },
      data: {
        ...(nombre      !== undefined && { nombre }),
        ...(apellido    !== undefined && { apellido }),
        ...(especialidad !== undefined && { especialidad }),
        ...(telefono    !== undefined && { telefono }),
        ...(email       !== undefined && { email }),
        ...(activo      !== undefined && { activo }),
      },
    })

    res.status(200).json(docente)
  } catch (error) {
    console.error('[docente.updateDocente]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/docentes/:id/asignacion ───────────────────────────────────────
export const asignarMateriaCurso = async (req: Request, res: Response): Promise<void> => {
  const docenteId = Number(req.params.id)
  const { materiaId, cursoId, gestionId } = req.body as {
    materiaId?: number
    cursoId?: number
    gestionId?: number
  }

  if (!materiaId || !cursoId || !gestionId) {
    res.status(400).json({ error: 'materiaId, cursoId y gestionId son obligatorios' })
    return
  }

  try {
    // Verificar que el docente existe
    const docente = await prisma.docente.findUnique({ where: { id: docenteId } })
    if (!docente) {
      res.status(404).json({ error: 'Docente no encontrado' })
      return
    }

    // Verificar asignación duplicada
    const duplicado = await prisma.docenteMateriaCurso.findUnique({
      where: {
        docenteId_materiaId_cursoId_gestionId: {
          docenteId, materiaId, cursoId, gestionId,
        },
      },
    })
    if (duplicado) {
      res.status(409).json({ error: 'Esta asignación ya existe' })
      return
    }

    // Verificar conflicto de horario
    // (un docente no puede tener dos materias en el mismo horario)
    const conflicto = await prisma.horario.findFirst({
      where: {
        docenteMateriaCurso: {
          docenteId,
          gestionId,
          // Solo verificamos si ya tiene horarios asignados en el mismo curso
          cursoId,
        },
      },
    })

    const asignacion = await prisma.docenteMateriaCurso.create({
      data: { docenteId, materiaId, cursoId, gestionId },
      include: {
        materia: true,
        curso:   true,
        gestion: { select: { id: true, anio: true } },
      },
    })

    res.status(201).json({
      ...asignacion,
      advertencia: conflicto ? 'El docente ya tiene asignaciones en este curso — revisa conflictos de horario.' : undefined,
    })
  } catch (error) {
    console.error('[docente.asignarMateriaCurso]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── DELETE /api/docentes/:id/asignacion/:asignacionId ───────────────────────
export const removeAsignacion = async (req: Request, res: Response): Promise<void> => {
  const asignacionId = Number(req.params.asignacionId)

  try {
    const existe = await prisma.docenteMateriaCurso.findUnique({
      where: { id: asignacionId },
    })
    if (!existe) {
      res.status(404).json({ error: 'Asignación no encontrada' })
      return
    }

    await prisma.docenteMateriaCurso.delete({ where: { id: asignacionId } })

    res.status(200).json({ message: 'Asignación eliminada correctamente' })
  } catch (error) {
    console.error('[docente.removeAsignacion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}