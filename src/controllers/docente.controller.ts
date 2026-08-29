import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'

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
        persona: search
          ? {
              OR: [
                { nombre:   { contains: search, mode: 'insensitive' } },
                { apellido: { contains: search, mode: 'insensitive' } },
                { ci:       { contains: search } },
              ],
            }
          : undefined,
      },
      include: {
        persona: true,
        usuario: { select: { id: true, username: true, activo: true } },
        asignaciones: {
          where: { gestion: { activa: true } },
          include: {
            materia: { select: { id: true, nombre: true, codigo: true } },
            curso:   { select: { id: true, nivel: true, grado: true, paralelo: true } },
          },
        },
      },
      orderBy: { persona: { apellido: 'asc' } },
    })

    res.status(200).json(docentes.map(aplanarPersona))
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
        persona: true,
        usuario: { select: { id: true, username: true, roles: true, activo: true } },
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

    res.status(200).json(aplanarPersona(docente))
  } catch (error) {
    console.error('[docente.getDocenteById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/docentes ───────────────────────────────────────────────────────
// Crea la Persona + el perfil Docente, SIN cuenta de acceso (usuarioId es
// nullable acá — a diferencia de Director/Secretaria, un docente puede
// existir en el sistema antes de tener usuario). Para vincularle cuenta,
// usar POST /api/usuarios/con-perfil o PUT /api/usuarios/:id/vincular.
export const createDocente = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, especialidad, telefono, email } = req.body as {
    ci?: string
    nombre?: string
    apellido?: string
    especialidad?: string
    telefono?: string
    email?: string
  }

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

    const docente = await prisma.$transaction(async tx => {
      const personaCreada = await crearPersona(tx, persona)
      return tx.docente.create({
        data:    { personaId: personaCreada.id, especialidad },
        include: { persona: true },
      })
    })

    res.status(201).json(aplanarPersona(docente))
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

    const docente = await prisma.docente.update({
      where: { id },
      data: {
        ...(especialidad !== undefined && { especialidad }),
        ...(activo       !== undefined && { activo }),
      },
      include: { persona: true },
    })

    res.status(200).json(aplanarPersona(docente))
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
    const docente = await prisma.docente.findUnique({ where: { id: docenteId } })
    if (!docente) {
      res.status(404).json({ error: 'Docente no encontrado' })
      return
    }

    // Validación amigable ANTES del insert: si el curso no pertenece a
    // esta gestión, la FK compuesta (cursoId, gestionId) -> Curso lo
    // rechazaría igual a nivel de Postgres, pero con un error crudo.
    const curso = await prisma.curso.findUnique({ where: { id: cursoId } })
    if (!curso) {
      res.status(404).json({ error: 'Curso no encontrado' })
      return
    }
    if (curso.gestionId !== gestionId) {
      res.status(400).json({
        error: `El curso pertenece a la gestión ${curso.gestionId}, no a la gestión ${gestionId}`,
      })
      return
    }

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

    // Un docente no puede tener dos materias en el mismo curso+gestión
    // con horarios que se pisen — acá solo advertimos si ya tiene
    // asignaciones en el curso; el cruce fino de horarios se valida en
    // horario.controller al crear el Horario.
    const conflicto = await prisma.docenteMateriaCurso.findFirst({
      where: { docenteId, gestionId, cursoId },
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

// ─── GET /api/docentes/mis-cursos ─────────────────────────────────────────────
// El docente ve todas sus asignaciones activas con los estudiantes de
// cada curso
export const getMisCursos = async (req: Request, res: Response): Promise<void> => {
  try {
    const docente = await prisma.docente.findFirst({
      where:   { usuarioId: req.user!.id },
      include: { persona: { select: { nombre: true, apellido: true } } },
    })

    if (!docente) {
      res.status(404).json({ error: 'Perfil de docente no encontrado' })
      return
    }

    const asignaciones = await prisma.docenteMateriaCurso.findMany({
      where: {
        docenteId: docente.id,
        gestion:   { activa: true },
      },
      include: {
        materia:  true,
        gestion:  { select: { id: true, anio: true } },
        horarios: { orderBy: { diaSemana: 'asc' } },
        curso: {
          include: {
            inscripciones: {
              include: {
                estudiante: {
                  select: {
                    id: true,
                    persona: { select: { nombre: true, apellido: true, ci: true } },
                  },
                },
              },
              orderBy: { estudiante: { persona: { apellido: 'asc' } } },
            },
          },
        },
      },
      orderBy: [
        { curso:   { nivel:  'asc' } },
        { materia: { nombre: 'asc' } },
      ],
    })

    const resultado = asignaciones.map(a => ({
      docenteMateriaCursoId: a.id,
      materia:  { id: a.materia.id, nombre: a.materia.nombre },
      curso:    { id: a.curso.id, nivel: a.curso.nivel, grado: a.curso.grado, paralelo: a.curso.paralelo },
      gestion:  a.gestion,
      horarios: a.horarios,
      totalEstudiantes: a.curso.inscripciones.length,
      estudiantes: a.curso.inscripciones.map(i => ({
        inscripcionId: i.id,
        id:            i.estudiante.id,
        ...i.estudiante.persona,
      })),
    }))

    res.status(200).json({
      docente: {
        id:       docente.id,
        nombre:   docente.persona.nombre,
        apellido: docente.persona.apellido,
      },
      totalAsignaciones: resultado.length,
      asignaciones:      resultado,
    })
  } catch (error) {
    console.error('[docente.getMisCursos]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}