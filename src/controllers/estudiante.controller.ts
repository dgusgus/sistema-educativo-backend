import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// ─── GET /api/estudiantes ─────────────────────────────────────────────────────
export const getEstudiantes = async (req: Request, res: Response): Promise<void> => {
  const { search, cursoId, gestionId, estadoInscripcion } = req.query as {
    search?:    string
    cursoId?:   string
    gestionId?: string
    estadoInscripcion?: string
  }

  try {
    const estudiantes = await prisma.estudiante.findMany({
      where: {
        activo: true,
        OR: search
          ? [
              { nombre:   { contains: search, mode: 'insensitive' } },
              { apellido: { contains: search, mode: 'insensitive' } },
              { ci:       { contains: search } },
            ]
          : undefined,
        inscripciones: cursoId || gestionId || estadoInscripcion
          ? {
              some: {
                ...(cursoId   && { cursoId:   Number(cursoId) }),
                ...(gestionId && { gestionId: Number(gestionId) }),
                ...(estadoInscripcion && { estado: estadoInscripcion }),
              },
            }
          : undefined,
      },
      include: {
        inscripciones: {
          include: {
            curso:   { select: { id: true, nombre: true, nivel: true } },
            gestion: { select: { id: true, anio: true, activa: true } },
          },
          orderBy: { gestion: { anio: 'desc' } },
          take: 1,
        },
        tutores: {
          include: {
            tutor: {
              select: {
                id: true, nombre: true, apellido: true,
                telefono: true, parentesco: true,
              },
            },
          },
        },
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    })

    res.status(200).json(estudiantes)
  } catch (error) {
    console.error('[estudiante.getEstudiantes]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/estudiantes/:id ─────────────────────────────────────────────────
export const getEstudianteById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  // Control RBAC: estudiante y tutor solo pueden ver su propia información
  if (req.user?.rol === 'ESTUDIANTE' || req.user?.rol === 'TUTOR') {
    const estudianteDelUsuario = await prisma.estudiante.findFirst({
      where: { usuarioId: req.user.id },
    })

    // Tutor: verificar que el estudiante esté vinculado a su cuenta
    if (req.user.rol === 'TUTOR') {
      const tutorDelUsuario = await prisma.tutor.findFirst({
        where: { usuarioId: req.user.id },
      })
      if (tutorDelUsuario) {
        const vinculo = await prisma.tutorEstudiante.findFirst({
          where: { tutorId: tutorDelUsuario.id, estudianteId: id },
        })
        if (!vinculo) {
          res.status(403).json({ error: 'Sin permisos para ver este estudiante' })
          return
        }
      }
    } else if (estudianteDelUsuario?.id !== id) {
      res.status(403).json({ error: 'Solo puedes ver tu propia información' })
      return
    }
  }

  try {
    const estudiante = await prisma.estudiante.findUnique({
      where: { id },
      include: {
        usuario: {
          select: { id: true, username: true, rol: true, activo: true },
        },
        inscripciones: {
          include: {
            curso:   true,
            gestion: true,
          },
          orderBy: { gestion: { anio: 'desc' } },
        },
        tutores: {
          include: {
            tutor: true,
          },
        },
      },
    })

    if (!estudiante) {
      res.status(404).json({ error: 'Estudiante no encontrado' })
      return
    }

    res.status(200).json(estudiante)
  } catch (error) {
    console.error('[estudiante.getEstudianteById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/estudiantes ────────────────────────────────────────────────────
export const createEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, fechaNacimiento, direccion } = req.body as {
    ci?:              string
    nombre?:          string
    apellido?:        string
    fechaNacimiento?: string
    direccion?:       string
  }

  if (!ci || !nombre || !apellido) {
    res.status(400).json({ error: 'CI, nombre y apellido son obligatorios' })
    return
  }

  try {
    const existe = await prisma.estudiante.findUnique({ where: { ci } })
    if (existe) {
      res.status(409).json({ error: `Ya existe un estudiante con el CI ${ci}` })
      return
    }

    const estudiante = await prisma.estudiante.create({
      data: {
        ci,
        nombre,
        apellido,
        fechaNacimiento: fechaNacimiento ? new Date(fechaNacimiento) : undefined,
        direccion,
      },
    })

    res.status(201).json(estudiante)
  } catch (error) {
    console.error('[estudiante.createEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/estudiantes/:id ─────────────────────────────────────────────────
export const updateEstudiante = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nombre, apellido, fechaNacimiento, direccion, activo } = req.body as {
    nombre?:          string
    apellido?:        string
    fechaNacimiento?: string
    direccion?:       string
    activo?:          boolean
  }

  try {
    const existe = await prisma.estudiante.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Estudiante no encontrado' })
      return
    }

    const estudiante = await prisma.estudiante.update({
      where: { id },
      data: {
        ...(nombre           !== undefined && { nombre }),
        ...(apellido         !== undefined && { apellido }),
        ...(fechaNacimiento  !== undefined && { fechaNacimiento: new Date(fechaNacimiento) }),
        ...(direccion        !== undefined && { direccion }),
        ...(activo           !== undefined && { activo }),
      },
    })

    res.status(200).json(estudiante)
  } catch (error) {
    console.error('[estudiante.updateEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/inscripciones ──────────────────────────────────────────────────
export const inscribirEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { estudianteId, cursoId, gestionId } = req.body as {
    estudianteId?: number
    cursoId?:      number
    gestionId?:    number
  }

  if (!estudianteId || !cursoId || !gestionId) {
    res.status(400).json({ error: 'estudianteId, cursoId y gestionId son obligatorios' })
    return
  }

  try {
    // Verificar que el estudiante existe
    const estudiante = await prisma.estudiante.findUnique({
      where: { id: estudianteId },
    })
    if (!estudiante) {
      res.status(404).json({ error: 'Estudiante no encontrado' })
      return
    }

    // Verificar inscripción duplicada en la misma gestión
    const duplicada = await prisma.inscripcion.findUnique({
      where: {
        estudianteId_gestionId: { estudianteId, gestionId },
      },
    })
    if (duplicada) {
      res.status(409).json({ error: 'El estudiante ya está inscrito en esta gestión' })
      return
    }

    const inscripcion = await prisma.inscripcion.create({
      data: { estudianteId, cursoId, gestionId },
      include: {
        estudiante: { select: { id: true, nombre: true, apellido: true } },
        curso:      { select: { id: true, nombre: true, nivel: true } },
        gestion:    { select: { id: true, anio: true } },
      },
    })

    res.status(201).json(inscripcion)
  } catch (error) {
    console.error('[estudiante.inscribirEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/inscripciones/:id ───────────────────────────────────────────────
export const getInscripcion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const inscripcion = await prisma.inscripcion.findUnique({
      where: { id },
      include: {
        estudiante: true,
        curso:      true,
        gestion:    true,
        pagos: {
          include: { conceptoPago: true },
          orderBy: { fechaPago: 'desc' },
        },
      },
    })

    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

    res.status(200).json(inscripcion)
  } catch (error) {
    console.error('[estudiante.getInscripcion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/inscripciones/:id/resultado ────────────────────────────────────
export const registrarResultado = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { resultado, observaciones } = req.body as {
    resultado?:    'PROMOVIDO' | 'REPROBADO'
    observaciones?: string
  }

  if (!resultado || !['PROMOVIDO', 'REPROBADO'].includes(resultado)) {
    res.status(400).json({ error: 'resultado debe ser PROMOVIDO o REPROBADO' })
    return
  }

  try {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id } })
    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

    // Verificar que todos los trimestres estén cerrados
    const trimestresAbiertos = await prisma.trimestre.findMany({
      where: {
        gestionId: inscripcion.gestionId,
        cerrado: false,
      },
    })
    if (trimestresAbiertos.length > 0) {
      res.status(400).json({
        error: 'No se puede registrar el resultado — hay trimestres sin cerrar',
        trimestresAbiertos: trimestresAbiertos.map(t => t.nombre),
      })
      return
    }

    const updated = await prisma.inscripcion.update({
      where: { id },
      data: { resultado, observaciones },
      include: {
        estudiante: { select: { nombre: true, apellido: true } },
        curso:      { select: { nombre: true } },
        gestion:    { select: { anio: true } },
      },
    })

    res.status(200).json(updated)
  } catch (error) {
    console.error('[estudiante.registrarResultado]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// En inscribirEstudiante — el campo estadoInscripcion se agrega automáticamente
// como ACTIVA por defecto en el schema, no necesitas cambiarlo.

// NUEVO endpoint — PUT /api/inscripciones/:id/estado
// Para registrar retiro o transferencia de un estudiante
export const cambiarEstadoInscripcion = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = Number(req.params.id)
  const { estadoInscripcion, fechaRetiro, observaciones } = req.body as {
    estadoInscripcion?: 'ACTIVA' | 'RETIRADA' | 'TRANSFERIDA' | 'CONCLUIDA'
    fechaRetiro?: string
    observaciones?: string
  }

  if (!estadoInscripcion) {
    res.status(400).json({ error: 'estadoInscripcion es obligatorio' })
    return
  }

  const estadosValidos = ['ACTIVA', 'RETIRADA', 'TRANSFERIDA', 'CONCLUIDA']
  if (!estadosValidos.includes(estadoInscripcion)) {
    res.status(400).json({
      error: `Estado inválido. Opciones: ${estadosValidos.join(', ')}`,
    })
    return
  }

  try {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id } })
    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

    // Si se retira o transfiere, registrar la fecha
    const necesitaFecha = ['RETIRADA', 'TRANSFERIDA'].includes(estadoInscripcion)

    const actualizada = await prisma.inscripcion.update({
      where: { id },
      data: {
        estadoInscripcion,
        fechaRetiro: necesitaFecha
          ? (fechaRetiro ? new Date(fechaRetiro) : new Date())
          : null,
        ...(observaciones !== undefined && { observaciones }),
      },
      include: {
        estudiante: { select: { nombre: true, apellido: true } },
        curso:      { select: { nombre: true } },
      },
    })

    res.status(200).json(actualizada)
  } catch (error) {
    console.error('[estudiante.cambiarEstadoInscripcion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}