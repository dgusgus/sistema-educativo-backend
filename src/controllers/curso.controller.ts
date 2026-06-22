import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// GET /api/cursos
export const getCursos = async (req: Request, res: Response): Promise<void> => {
  const { gestionId } = req.query as { gestionId?: string }

  try {
    const cursos = await prisma.curso.findMany({
      where: gestionId
        ? { gestionId: Number(gestionId) }
        : { gestion: { activa: true } },
      include: {
        gestion: { select: { id: true, anio: true } },
        _count:  { select: { inscripciones: true, asignaciones: true } },
      },
      orderBy: [{ nivel: 'asc' }, { paralelo: 'asc' }],
    })
    res.status(200).json(cursos)
  } catch (error) {
    console.error('[curso.getCursos]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/cursos/:id
export const getCursoById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const curso = await prisma.curso.findUnique({
      where: { id },
      include: {
        gestion: { select: { id: true, anio: true } },
        inscripciones: {
          include: { estudiante: { select: { id: true, nombre: true, apellido: true } } },
          orderBy: { estudiante: { apellido: 'asc' } },
        },
        asignaciones: {
          include: {
            materia: { select: { id: true, nombre: true } },
            docente: { select: { id: true, nombre: true, apellido: true } },
          },
        },
      },
    })
    if (!curso) {
      res.status(404).json({ error: 'Curso no encontrado' })
      return
    }
    res.status(200).json(curso)
  } catch (error) {
    console.error('[curso.getCursoById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/cursos
export const createCurso = async (req: Request, res: Response): Promise<void> => {
  const { nombre, nivel, paralelo, gestionId } = req.body as {
    nombre?: string
    nivel?: string
    paralelo?: string
    gestionId?: number
  }

  if (!nombre || !nivel || !paralelo || !gestionId) {
    res.status(400).json({ error: 'nombre, nivel, paralelo y gestionId son obligatorios' })
    return
  }

  try {
    const existe = await prisma.curso.findUnique({
      where: { nivel_paralelo_gestionId: { nivel, paralelo, gestionId } },
    })
    if (existe) {
      res.status(409).json({ error: `Ya existe el curso ${nivel} paralelo ${paralelo} en esta gestión` })
      return
    }

    const curso = await prisma.curso.create({
      data: { nombre, nivel, paralelo, gestionId },
      include: { gestion: { select: { id: true, anio: true } } },
    })
    res.status(201).json(curso)
  } catch (error) {
    console.error('[curso.createCurso]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/cursos/:id
export const updateCurso = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, nivel, paralelo } = req.body as {
    nombre?: string
    nivel?: string
    paralelo?: string
  }

  try {
    const existe = await prisma.curso.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Curso no encontrado' })
      return
    }

    const curso = await prisma.curso.update({
      where: { id },
      data: {
        ...(nombre   !== undefined && { nombre }),
        ...(nivel    !== undefined && { nivel }),
        ...(paralelo !== undefined && { paralelo }),
      },
    })
    res.status(200).json(curso)
  } catch (error) {
    console.error('[curso.updateCurso]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// DELETE /api/cursos/:id
export const deleteCurso = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const inscripciones = await prisma.inscripcion.count({ where: { cursoId: id } })
    if (inscripciones > 0) {
      res.status(400).json({
        error: `No se puede eliminar — el curso tiene ${inscripciones} estudiantes inscritos`,
      })
      return
    }

    await prisma.curso.delete({ where: { id } })
    res.status(200).json({ message: 'Curso eliminado correctamente' })
  } catch (error) {
    console.error('[curso.deleteCurso]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}