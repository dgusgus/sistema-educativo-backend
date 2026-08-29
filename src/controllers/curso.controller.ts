import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { conNombre } from '../lib/curso.helper.js'

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
      orderBy: [{ nivel: 'asc' }, { grado: 'asc' }, { paralelo: 'asc' }],
    })
    res.status(200).json(cursos.map(conNombre))
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
        tutorDocente: { select: { id: true, persona: { select: { nombre: true, apellido: true } } } },
        inscripciones: {
          include: { estudiante: { select: { id: true, persona: { select: { nombre: true, apellido: true } } } } },
          orderBy: { estudiante: { persona: { apellido: 'asc' } } },
        },
        asignaciones: {
          include: {
            materia: { select: { id: true, nombre: true } },
            docente: { select: { id: true, persona: { select: { nombre: true, apellido: true } } } },
          },
        },
      },
    })
    if (!curso) {
      res.status(404).json({ error: 'Curso no encontrado' })
      return
    }
    res.status(200).json({
      ...conNombre(curso),
      tutorDocente: curso.tutorDocente ? aplanarPersona(curso.tutorDocente) : null,
      inscripciones: curso.inscripciones.map(i => ({ ...i, estudiante: aplanarPersona(i.estudiante) })),
      asignaciones: curso.asignaciones.map(a => ({ ...a, docente: aplanarPersona(a.docente) })),
    })
  } catch (error) {
    console.error('[curso.getCursoById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/cursos
export const createCurso = async (req: Request, res: Response): Promise<void> => {
  const { nivel, grado, paralelo, turno, capacidad, gestionId } = req.body as {
    nivel?:     'PRIMARIA' | 'SECUNDARIA'
    grado?:     number
    paralelo?:  string
    turno?:     'MANANA' | 'TARDE' | 'NOCHE'
    capacidad?: number
    gestionId?: number
  }

  if (!nivel || !grado || !paralelo || !gestionId) {
    res.status(400).json({ error: 'nivel, grado, paralelo y gestionId son obligatorios' })
    return
  }

  try {
    const turnoFinal = turno ?? 'MANANA'

    const existe = await prisma.curso.findUnique({
      where: {
        nivel_grado_paralelo_turno_gestionId: { nivel, grado, paralelo, turno: turnoFinal, gestionId },
      },
    })
    if (existe) {
      res.status(409).json({ error: `Ya existe el curso ${grado}° ${nivel} "${paralelo}" (${turnoFinal}) en esta gestión` })
      return
    }

    const curso = await prisma.curso.create({
      data: { nivel, grado, paralelo, turno: turnoFinal, capacidad, gestionId },
      include: { gestion: { select: { id: true, anio: true } } },
    })
    res.status(201).json(conNombre(curso))
  } catch (error) {
    console.error('[curso.createCurso]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/cursos/:id
export const updateCurso = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { grado, paralelo, turno, capacidad, activo, tutorDocenteId } = req.body as {
    grado?:          number
    paralelo?:       string
    turno?:          'MANANA' | 'TARDE' | 'NOCHE'
    capacidad?:      number
    activo?:         boolean
    tutorDocenteId?: number | null
  }
  // nivel NO se puede editar acá a propósito: cambiar el nivel de un
  // curso ya con inscripciones rompe el historial académico. Si hace
  // falta, se crea un curso nuevo.

  try {
    const existe = await prisma.curso.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Curso no encontrado' })
      return
    }

    const curso = await prisma.curso.update({
      where: { id },
      data: {
        ...(grado          !== undefined && { grado }),
        ...(paralelo       !== undefined && { paralelo }),
        ...(turno          !== undefined && { turno }),
        ...(capacidad      !== undefined && { capacidad }),
        ...(activo         !== undefined && { activo }),
        ...(tutorDocenteId !== undefined && { tutorDocenteId }),
      },
    })
    res.status(200).json(conNombre(curso))
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