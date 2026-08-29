import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'

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
        persona: search
          ? {
              OR: [
                { nombre:   { contains: search, mode: 'insensitive' } },
                { apellido: { contains: search, mode: 'insensitive' } },
                { ci:       { contains: search } },
              ],
            }
          : undefined,
        inscripciones: cursoId || gestionId || estadoInscripcion
          ? {
              some: {
                ...(cursoId   && { cursoId:   Number(cursoId) }),
                ...(gestionId && { gestionId: Number(gestionId) }),
                // ⚠️ antes decía "estado" — el campo real es "estadoInscripcion"
                ...(estadoInscripcion && { estadoInscripcion: estadoInscripcion as any }),
              },
            }
          : undefined,
      },
      include: {
        persona: true,
        inscripciones: {
          include: {
            curso:   { select: { id: true, nivel: true, grado: true, paralelo: true } },
            gestion: { select: { id: true, anio: true, activa: true } },
          },
          orderBy: { gestion: { anio: 'desc' } },
          take: 1,
        },
        tutores: {
          include: {
            tutor: {
              select: {
                id: true,
                parentesco: true,
                persona: { select: { nombre: true, apellido: true, telefono: true } },
              },
            },
          },
        },
      },
      orderBy: { persona: { apellido: 'asc' } },
    })

    res.status(200).json(estudiantes.map(e => ({
      ...aplanarPersona(e),
      tutores: e.tutores.map(t => ({
        ...t,
        tutor: { id: t.tutor.id, ...t.tutor.persona },
      })),
    })))
  } catch (error) {
    console.error('[estudiante.getEstudiantes]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/estudiantes/:id ─────────────────────────────────────────────────
export const getEstudianteById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  // Control RBAC: si el usuario SOLO tiene roles de familia (estudiante
  // y/o tutor, sin ningún rol de staff), solo puede ver su propia info.
  const soloFamilia = req.user
    ? req.user.roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r))
    : false

  if (soloFamilia) {
    if (req.user!.roles.includes('TUTOR')) {
      const tutorDelUsuario = await prisma.tutor.findFirst({ where: { usuarioId: req.user!.id } })
      if (tutorDelUsuario) {
        const vinculo = await prisma.tutorEstudiante.findFirst({
          where: { tutorId: tutorDelUsuario.id, estudianteId: id },
        })
        if (!vinculo) {
          res.status(403).json({ error: 'Sin permisos para ver este estudiante' })
          return
        }
      }
    } else {
      const estudianteDelUsuario = await prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id } })
      if (estudianteDelUsuario?.id !== id) {
        res.status(403).json({ error: 'Solo puedes ver tu propia información' })
        return
      }
    }
  }

  try {
    const estudiante = await prisma.estudiante.findUnique({
      where: { id },
      include: {
        persona: true,
        usuario: { select: { id: true, username: true, roles: true, activo: true } },
        inscripciones: {
          include: { curso: true, gestion: true },
          orderBy: { gestion: { anio: 'desc' } },
        },
        tutores: {
          include: { tutor: { include: { persona: true } } },
        },
      },
    })

    if (!estudiante) {
      res.status(404).json({ error: 'Estudiante no encontrado' })
      return
    }

    res.status(200).json({
      ...aplanarPersona(estudiante),
      tutores: estudiante.tutores.map(t => ({ ...t, tutor: aplanarPersona(t.tutor) })),
    })
  } catch (error) {
    console.error('[estudiante.getEstudianteById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/estudiantes ────────────────────────────────────────────────────
export const createEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, fechaNacimiento, direccion, rude } = req.body as {
    ci?:              string
    nombre?:          string
    apellido?:        string
    fechaNacimiento?: string
    direccion?:       string
    rude?:            string
  }

  const persona: PersonaInput = {
    ci: ci ?? '', nombre: nombre ?? '', apellido: apellido ?? '', fechaNacimiento, direccion,
  }
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

    const estudiante = await prisma.$transaction(async tx => {
      const personaCreada = await crearPersona(tx, persona)
      return tx.estudiante.create({
        data:    { personaId: personaCreada.id, rude },
        include: { persona: true },
      })
    })

    res.status(201).json(aplanarPersona(estudiante))
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

    if (nombre !== undefined || apellido !== undefined || fechaNacimiento !== undefined || direccion !== undefined) {
      await prisma.persona.update({
        where: { id: existe.personaId },
        data: {
          ...(nombre          !== undefined && { nombre }),
          ...(apellido        !== undefined && { apellido }),
          ...(fechaNacimiento !== undefined && { fechaNacimiento: new Date(fechaNacimiento) }),
          ...(direccion       !== undefined && { direccion }),
        },
      })
    }

    const estudiante = await prisma.estudiante.update({
      where: { id },
      data:  { ...(activo !== undefined && { activo }) },
      include: { persona: true },
    })

    res.status(200).json(aplanarPersona(estudiante))
  } catch (error) {
    console.error('[estudiante.updateEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/inscripciones ──────────────────────────────────────────────────
export const inscribirEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { estudianteId, cursoId, gestionId, procedencia } = req.body as {
    estudianteId?: number
    cursoId?:      number
    gestionId?:    number
    procedencia?:  string
  }

  if (!estudianteId || !cursoId || !gestionId) {
    res.status(400).json({ error: 'estudianteId, cursoId y gestionId son obligatorios' })
    return
  }

  try {
    const estudiante = await prisma.estudiante.findUnique({ where: { id: estudianteId } })
    if (!estudiante) {
      res.status(404).json({ error: 'Estudiante no encontrado' })
      return
    }

    // Validación amigable antes de que la FK compuesta (cursoId, gestionId)
    // -> Curso rechace el insert con un error de Postgres crudo.
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

    const duplicada = await prisma.inscripcion.findUnique({
      where: { estudianteId_gestionId: { estudianteId, gestionId } },
    })
    if (duplicada) {
      res.status(409).json({ error: 'El estudiante ya está inscrito en esta gestión' })
      return
    }

    const inscripcion = await prisma.inscripcion.create({
      data: { estudianteId, cursoId, gestionId, procedencia },
      include: {
        estudiante: { include: { persona: { select: { nombre: true, apellido: true } } } },
        curso:      true,
        gestion:    { select: { id: true, anio: true } },
      },
    })

    res.status(201).json({
      ...inscripcion,
      estudiante: aplanarPersona(inscripcion.estudiante),
    })
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
        estudiante: { include: { persona: true } },
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

    res.status(200).json({ ...inscripcion, estudiante: aplanarPersona(inscripcion.estudiante) })
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

    const trimestresAbiertos = await prisma.trimestre.findMany({
      where: { gestionId: inscripcion.gestionId, cerrado: false },
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
      data:  { resultado, observaciones },
      include: {
        estudiante: { include: { persona: { select: { nombre: true, apellido: true } } } },
        curso:      true,
        gestion:    { select: { anio: true } },
      },
    })

    res.status(200).json({ ...updated, estudiante: aplanarPersona(updated.estudiante) })
  } catch (error) {
    console.error('[estudiante.registrarResultado]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/inscripciones/:id/estado ────────────────────────────────────────
// Registra retiro o transferencia de un estudiante
export const cambiarEstadoInscripcion = async (req: Request, res: Response): Promise<void> => {
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
    res.status(400).json({ error: `Estado inválido. Opciones: ${estadosValidos.join(', ')}` })
    return
  }

  try {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id } })
    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

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
        estudiante: { include: { persona: { select: { nombre: true, apellido: true } } } },
        curso:      true,
      },
    })

    res.status(200).json({ ...actualizada, estudiante: aplanarPersona(actualizada.estudiante) })
  } catch (error) {
    console.error('[estudiante.cambiarEstadoInscripcion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}