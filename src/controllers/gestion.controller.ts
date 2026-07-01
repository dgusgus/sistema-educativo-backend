import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// ─── GET /api/gestiones ───────────────────────────────────────────────────────
export const getGestiones = async (_req: Request, res: Response): Promise<void> => {
  try {
    const gestiones = await prisma.gestion.findMany({
      include: {
        director: {
          select: { id: true, nombre: true, apellido: true },
        },
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

// ─── GET /api/gestiones/activa ────────────────────────────────────────────────
export const getGestionActiva = async (_req: Request, res: Response): Promise<void> => {
  try {
    const gestion = await prisma.gestion.findFirst({
      where: { activa: true },
      include: {
        director: {
          select: { id: true, nombre: true, apellido: true, telefono: true, email: true },
        },
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

// ─── GET /api/gestiones/:id ───────────────────────────────────────────────────
export const getGestionById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const gestion = await prisma.gestion.findUnique({
      where: { id },
      include: {
        director: { select: { id: true, nombre: true, apellido: true } },
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

// ─── POST /api/gestiones ──────────────────────────────────────────────────────
export const createGestion = async (req: Request, res: Response): Promise<void> => {
  const { anio, descripcion, fechaInicio, fechaFin, directorId } = req.body as {
    anio?: number
    descripcion?: string
    fechaInicio?: string
    fechaFin?: string
    directorId?: number
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

    // Si se especifica un director, verificar que exista y esté activo
    if (directorId) {
      const director = await prisma.director.findUnique({ where: { id: directorId } })
      if (!director) {
        res.status(404).json({ error: 'Director no encontrado' })
        return
      }
      if (!director.activo) {
        res.status(400).json({ error: 'El director no está activo' })
        return
      }
    }

    const gestion = await prisma.gestion.create({
      data: {
        anio,
        descripcion: descripcion ?? `Gestión Escolar ${anio}`,
        fechaInicio: fechaInicio ? new Date(fechaInicio) : undefined,
        fechaFin:    fechaFin    ? new Date(fechaFin)    : undefined,
        directorId,
      },
      include: {
        director: { select: { nombre: true, apellido: true } },
      },
    })
    res.status(201).json(gestion)
  } catch (error) {
    console.error('[gestion.createGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/gestiones/:id ───────────────────────────────────────────────────
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

// ─── PUT /api/gestiones/:id/director ─────────────────────────────────────────
// Asigna o cambia el director de una gestión específica
// ¿Por qué un endpoint separado? Porque cambiar el director
// es una acción institucional importante que merece su propio registro
export const asignarDirector = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { directorId } = req.body as { directorId?: number }

  if (!directorId) {
    res.status(400).json({ error: 'directorId es obligatorio' })
    return
  }

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    const director = await prisma.director.findUnique({ where: { id: directorId } })
    if (!director) {
      res.status(404).json({ error: 'Director no encontrado' })
      return
    }
    if (!director.activo) {
      res.status(400).json({ error: 'El director no está activo' })
      return
    }

    const actualizada = await prisma.gestion.update({
      where: { id },
      data:  { directorId },
      include: {
        director: { select: { id: true, nombre: true, apellido: true } },
      },
    })

    res.status(200).json({
      gestion: actualizada,
      mensaje: `${director.nombre} ${director.apellido} asignado como director de la gestión ${gestion.anio}`,
    })
  } catch (error) {
    console.error('[gestion.asignarDirector]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/gestiones/:id/activar ──────────────────────────────────────────
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
      include: { director: { select: { nombre: true, apellido: true } } },
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

// ─── POST /api/gestiones/:id/cerrar ──────────────────────────────────────────
// ¿Por qué este endpoint? Marca formalmente el fin del año académico.
// Antes de cerrar, verifica que todo esté en orden:
//   1. Los 3 trimestres deben estar cerrados
//   2. Todos los estudiantes activos deben tener un resultado final
export const cerrarGestion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    if (!gestion.activa) {
      res.status(400).json({ error: 'Esta gestión ya no está activa' })
      return
    }

    // Verificar trimestres cerrados
    const trimestresAbiertos = await prisma.trimestre.findMany({
      where: { gestionId: id, cerrado: false },
    })
    if (trimestresAbiertos.length > 0) {
      res.status(400).json({
        error: 'No se puede cerrar la gestión — hay trimestres sin cerrar',
        trimestresAbiertos: trimestresAbiertos.map(t => t.nombre),
      })
      return
    }

    // Verificar que todos los estudiantes ACTIVOS tengan resultado
    const sinResultado = await prisma.inscripcion.findMany({
      where: {
        gestionId: id,
        estadoInscripcion: 'ACTIVA',
        resultado: 'PENDIENTE',
      },
      include: {
        estudiante: { select: { nombre: true, apellido: true } },
      },
    })
    if (sinResultado.length > 0) {
      res.status(400).json({
        error: `${sinResultado.length} estudiantes activos sin resultado final registrado`,
        sugerencia: 'Registra PROMOVIDO o REPROBADO con POST /inscripciones/:id/resultado',
        estudiantesPendientes: sinResultado.map(
          i => `${i.estudiante.nombre} ${i.estudiante.apellido}`
        ),
      })
      return
    }

    // Marcar las inscripciones activas como CONCLUIDA
    await prisma.inscripcion.updateMany({
      where: { gestionId: id, estadoInscripcion: 'ACTIVA' },
      data:  { estadoInscripcion: 'CONCLUIDA' },
    })

    // Desactivar la gestión
    const cerrada = await prisma.gestion.update({
      where: { id },
      data:  { activa: false },
    })

    res.status(200).json({
      message: `Gestión ${cerrada.anio} cerrada correctamente`,
      gestion: cerrada,
      siguientePaso: 'Crea la siguiente gestión y usa GET /gestiones/:id/propuesta-inscripciones para preparar las inscripciones del nuevo año',
    })
  } catch (error) {
    console.error('[gestion.cerrarGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/gestiones/:id/propuesta-inscripciones ──────────────────────────
// ¿Por qué? La secretaria necesita ayuda para saber a qué curso
// debe inscribir a cada estudiante el siguiente año, basándose
// en el resultado de la gestión anterior.
// ¿Para qué? No automatiza la inscripción (puede haber casos
// especiales) pero SUGIERE el curso correcto para agilizar el proceso.
export const getPropuestaInscripciones = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  // Orden de niveles para calcular el "siguiente curso"
  const NIVELES = [
    'Primero Secundaria',
    'Segundo Secundaria',
    'Tercero Secundaria',
    'Cuarto Secundaria',
    'Quinto Secundaria',
    'Sexto Secundaria',
  ]

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    const inscripciones = await prisma.inscripcion.findMany({
      where: { gestionId: id },
      include: {
        estudiante: { select: { id: true, nombre: true, apellido: true, ci: true } },
        curso:      { select: { nivel: true, paralelo: true, nombre: true } },
      },
      orderBy: [
        { curso: { nivel: 'asc' } },
        { estudiante: { apellido: 'asc' } },
      ],
    })

    const propuesta = inscripciones.map(insc => {
      const indexActual = NIVELES.indexOf(insc.curso.nivel)

      let cursoSugerido: string | null = null
      let accion = ''

      if (insc.estadoInscripcion === 'RETIRADA') {
        accion = 'NO_CONTINUA'
      } else if (insc.estadoInscripcion === 'TRANSFERIDA') {
        accion = 'NO_CONTINUA'
      } else if (insc.resultado === 'REPROBADO') {
        cursoSugerido = `${insc.curso.nivel} ${insc.curso.paralelo}`
        accion = 'REPETIR_CURSO'
      } else if (insc.resultado === 'PROMOVIDO') {
        if (indexActual === -1) {
          accion = 'REVISAR_MANUALMENTE'
        } else if (indexActual < NIVELES.length - 1) {
          cursoSugerido = `${NIVELES[indexActual + 1]} ${insc.curso.paralelo}`
          accion = 'PROMOVER'
        } else {
          accion = 'EGRESADO'
        }
      } else {
        accion = 'SIN_RESULTADO'
      }

      return {
        estudianteId:  insc.estudiante.id,
        estudiante:    `${insc.estudiante.nombre} ${insc.estudiante.apellido}`,
        ci:            insc.estudiante.ci,
        cursoActual:   insc.curso.nombre,
        estado:        insc.estadoInscripcion,
        resultado:     insc.resultado,
        accion,
        cursoSugerido,
      }
    })

    // Resumen por tipo de acción
    const resumen = {
      promover:          propuesta.filter(p => p.accion === 'PROMOVER').length,
      repetir:            propuesta.filter(p => p.accion === 'REPETIR_CURSO').length,
      egresados:          propuesta.filter(p => p.accion === 'EGRESADO').length,
      noContinua:         propuesta.filter(p => p.accion === 'NO_CONTINUA').length,
      revisarManualmente: propuesta.filter(p =>
        p.accion === 'REVISAR_MANUALMENTE' || p.accion === 'SIN_RESULTADO'
      ).length,
    }

    res.status(200).json({
      gestion: { id: gestion.id, anio: gestion.anio },
      resumen,
      propuesta,
    })
  } catch (error) {
    console.error('[gestion.getPropuestaInscripciones]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}