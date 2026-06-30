import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// ─── GET /api/calificaciones ──────────────────────────────────────────────────
// El docente ve la planilla de notas de su materia por trimestre
// Query params: docenteMateriaCursoId, trimestreId
export const getCalificaciones = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, trimestreId } = req.query as {
    docenteMateriaCursoId?: string
    trimestreId?: string
  }

  if (!docenteMateriaCursoId || !trimestreId) {
    res.status(400).json({
      error: 'docenteMateriaCursoId y trimestreId son obligatorios',
    })
    return
  }

  try {
    const dmcId  = Number(docenteMateriaCursoId)
    const trimId = Number(trimestreId)

    // Verificar acceso del docente
    if (req.user?.rol === 'DOCENTE') {
      const docente = await prisma.docente.findFirst({
        where: { usuarioId: req.user.id },
      })
      const asignacion = await prisma.docenteMateriaCurso.findFirst({
        where: { id: dmcId, docenteId: docente?.id },
      })
      if (!asignacion) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    // Obtener la asignación con info de materia y curso
    const dmc = await prisma.docenteMateriaCurso.findUnique({
      where: { id: dmcId },
      include: {
        materia:  { select: { id: true, nombre: true } },
        curso:    { select: { id: true, nombre: true } },
        gestion:  { select: { id: true, anio: true } },
      },
    })

    if (!dmc) {
      res.status(404).json({ error: 'Asignación no encontrada' })
      return
    }

    // Obtener trimestre
    const trimestre = await prisma.trimestre.findUnique({
      where: { id: trimId },
    })

    if (!trimestre) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }

    // Obtener todos los estudiantes del curso con sus notas
    const inscripciones = await prisma.inscripcion.findMany({
      where: { cursoId: dmc.cursoId, gestionId: dmc.gestionId },
      include: {
        estudiante: {
          select: { id: true, nombre: true, apellido: true, ci: true },
        },
        calificaciones: {
          where: {
            docenteMateriaCursoId: dmcId,
            trimestreId: trimId,
          },
        },
      },
      orderBy: { estudiante: { apellido: 'asc' } },
    })

    // Armar la planilla
    const planilla = inscripciones.map(insc => ({
      inscripcionId:   insc.id,
      estudiante:      insc.estudiante,
      calificacionId:  insc.calificaciones[0]?.id ?? null,
      nota:            insc.calificaciones[0]?.nota ?? null,
      promedio:        insc.calificaciones[0]?.promedioTrimestral ?? null,
      registrado:      insc.calificaciones.length > 0,
    }))

    res.status(200).json({
      dmc,
      trimestre,
      trimestreCerrado: trimestre.cerrado,
      totalEstudiantes: planilla.length,
      notasRegistradas: planilla.filter(p => p.registrado).length,
      planilla,
    })
  } catch (error) {
    console.error('[calificacion.getCalificaciones]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/calificaciones ─────────────────────────────────────────────────
// El docente registra las notas de toda la planilla de una vez
// Body: { docenteMateriaCursoId, trimestreId, notas: [{inscripcionId, nota}] }
export const registrarCalificaciones = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, trimestreId, notas } = req.body as {
    docenteMateriaCursoId?: number
    trimestreId?: number
    notas?: Array<{ inscripcionId: number; nota: number }>
  }

  if (!docenteMateriaCursoId || !trimestreId || !notas?.length) {
    res.status(400).json({
      error: 'docenteMateriaCursoId, trimestreId y notas son obligatorios',
    })
    return
  }

  // Validar rango de notas (Ley 070: escala 1-100)
  const notaInvalida = notas.find(n => n.nota < 1 || n.nota > 100)
  if (notaInvalida) {
    res.status(400).json({
      error: `Nota inválida: ${notaInvalida.nota}. La escala es 1-100 conforme a la Ley 070`,
    })
    return
  }

  try {
    // Verificar que el trimestre no esté cerrado
    const trimestre = await prisma.trimestre.findUnique({
      where: { id: trimestreId },
    })
    if (!trimestre) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }
    if (trimestre.cerrado) {
      res.status(403).json({
        error: 'El trimestre está cerrado — no se pueden modificar calificaciones',
      })
      return
    }

    // Verificar acceso del docente
    if (req.user?.rol === 'DOCENTE') {
      const docente = await prisma.docente.findFirst({
        where: { usuarioId: req.user.id },
      })
      const asignacion = await prisma.docenteMateriaCurso.findFirst({
        where: { id: docenteMateriaCursoId, docenteId: docente?.id },
      })
      if (!asignacion) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    // Registrar o actualizar notas (upsert)
    // La nota trimestral = la nota registrada (el promedio puede venir de
    // múltiples evaluaciones pero en este sistema se registra el promedio final)
    const resultado = await prisma.$transaction(
      notas.map(n =>
        prisma.calificacion.upsert({
          where: {
            inscripcionId_docenteMateriaCursoId_trimestreId: {
              inscripcionId:         n.inscripcionId,
              docenteMateriaCursoId,
              trimestreId,
            },
          },
          update: {
            nota:               n.nota,
            promedioTrimestral: n.nota,
          },
          create: {
            inscripcionId:         n.inscripcionId,
            docenteMateriaCursoId,
            trimestreId,
            nota:               n.nota,
            promedioTrimestral: n.nota,
          },
        })
      )
    )

    // Calcular promedios finales por materia si existen los 3 trimestres
    await calcularPromediosFinales(docenteMateriaCursoId)

    res.status(201).json({
      registradas: resultado.length,
      trimestreId,
      docenteMateriaCursoId,
    })
  } catch (error) {
    console.error('[calificacion.registrarCalificaciones]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/calificaciones/:id ──────────────────────────────────────────────
// Editar una nota individual antes del cierre del trimestre
export const updateCalificacion = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id   = Number(req.params.id)
  const { nota, motivo } = req.body as {
    nota?:   number
    motivo?: string  // ← nuevo campo
  }

  if (nota === undefined || nota < 1 || nota > 100) {
    res.status(400).json({ error: 'nota debe estar entre 1 y 100 (Ley 070)' })
    return
  }

  try {
    const calificacion = await prisma.calificacion.findUnique({
      where:   { id },
      include: { trimestre: true },
    })

    if (!calificacion) {
      res.status(404).json({ error: 'Calificación no encontrada' })
      return
    }

    if (calificacion.trimestre.cerrado) {
      res.status(403).json({
        error: 'No se puede editar — el trimestre está cerrado',
      })
      return
    }

    // Guardar en historial + actualizar nota en una transacción
    const [historial, calificacionActualizada] = await prisma.$transaction([
      // 1. Registrar el cambio en el historial
      prisma.historialCalificacion.create({
        data: {
          notaAnterior:  calificacion.nota,
          notaNueva:     nota,
          motivo:        motivo ?? 'Sin motivo especificado',
          usuarioId:     req.user!.id,
          calificacionId: id,
        },
      }),
      // 2. Actualizar la nota
      prisma.calificacion.update({
        where: { id },
        data:  { nota, promedioTrimestral: nota },
      }),
    ])

    // Recalcular promedios finales
    await calcularPromediosFinales(calificacion.docenteMateriaCursoId)

    res.status(200).json({
      calificacion: calificacionActualizada,
      historial,
    })
  } catch (error) {
    console.error('[calificacion.updateCalificacion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/trimestres/:id/cerrar ─────────────────────────────────────────
// Cierra el trimestre — las notas quedan bloqueadas
export const cerrarTrimestre = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const trimestre = await prisma.trimestre.findUnique({
      where: { id },
      include: { gestion: { include: { cursos: true } } },
    })

    if (!trimestre) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }

    if (trimestre.cerrado) {
      res.status(400).json({ error: 'El trimestre ya está cerrado' })
      return
    }

    // Verificar que todas las calificaciones estén registradas
    // (al menos una nota por cada inscripción activa en la gestión)
    const inscripciones = await prisma.inscripcion.findMany({
      where: { gestionId: trimestre.gestionId },
      select: { id: true },
    })

    const calificaciones = await prisma.calificacion.findMany({
      where: { trimestreId: id },
      select: { inscripcionId: true },
    })

    const sinNota = inscripciones.filter(
      insc => !calificaciones.some(c => c.inscripcionId === insc.id)
    )

    if (sinNota.length > 0) {
      res.status(400).json({
        error: `Hay ${sinNota.length} estudiantes sin calificaciones registradas`,
        sugerencia: 'Registra todas las notas antes de cerrar el trimestre',
      })
      return
    }

    // Cerrar el trimestre
    const trimCerrado = await prisma.trimestre.update({
      where: { id },
      data: { cerrado: true },
    })

    res.status(200).json({
      message: `Trimestre "${trimestre.nombre}" cerrado correctamente`,
      trimestre: trimCerrado,
    })
  } catch (error) {
    console.error('[calificacion.cerrarTrimestre]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/calificaciones/estudiante ──────────────────────────────────────
// Estudiante o Tutor consultan sus propias notas
export const getCalificacionesEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { estudianteId, gestionId } = req.query as {
    estudianteId?: string
    gestionId?: string
  }

  try {
    let estId: number

    if (req.user?.rol === 'ESTUDIANTE') {
      const estudiante = await prisma.estudiante.findFirst({
        where: { usuarioId: req.user.id },
      })
      if (!estudiante) {
        res.status(403).json({ error: 'Perfil de estudiante no encontrado' })
        return
      }
      estId = estudiante.id

    } else if (req.user?.rol === 'TUTOR') {
      if (!estudianteId) {
        res.status(400).json({ error: 'estudianteId es requerido' })
        return
      }
      // Verificar vínculo tutor → estudiante
      const tutor = await prisma.tutor.findFirst({
        where: { usuarioId: req.user.id },
      })
      const vinculo = await prisma.tutorEstudiante.findFirst({
        where: { tutorId: tutor?.id, estudianteId: Number(estudianteId) },
      })
      if (!vinculo) {
        res.status(403).json({ error: 'Sin permisos para ver este estudiante' })
        return
      }
      estId = Number(estudianteId)

    } else {
      if (!estudianteId) {
        res.status(400).json({ error: 'estudianteId es requerido' })
        return
      }
      estId = Number(estudianteId)
    }

    // Obtener inscripciones del estudiante
    const inscripciones = await prisma.inscripcion.findMany({
      where: {
        estudianteId: estId,
        ...(gestionId && { gestionId: Number(gestionId) }),
      },
      include: {
        curso:   { select: { nombre: true } },
        gestion: { select: { anio: true } },
        calificaciones: {
          include: {
            docenteMateriaCurso: {
              include: { materia: { select: { nombre: true } } },
            },
            trimestre: { select: { numero: true, nombre: true } },
          },
          orderBy: [
            { trimestre: { numero: 'asc' } },
          ],
        },
        promediosFinales: {
          include: {
            docenteMateriaCurso: {
              include: { materia: { select: { nombre: true } } },
            },
          },
        },
      },
    })

    res.status(200).json(inscripciones)
  } catch (error) {
    console.error('[calificacion.getCalificacionesEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ══════════════════════════════════════
// FUNCIÓN AUXILIAR
// ══════════════════════════════════════

// Calcula el promedio final por materia cuando los 3 trimestres tienen nota
async function calcularPromediosFinales(docenteMateriaCursoId: number) {
  // Obtener todas las inscripciones con notas en esta materia
  const calificaciones = await prisma.calificacion.findMany({
    where: { docenteMateriaCursoId },
    include: {
      trimestre: { select: { numero: true } },
    },
  })

  // Agrupar por inscripción
  const porInscripcion: Record<number, number[]> = {}
  for (const cal of calificaciones) {
    if (!porInscripcion[cal.inscripcionId]) {
      porInscripcion[cal.inscripcionId] = []
    }
    porInscripcion[cal.inscripcionId].push(cal.nota)
  }

  // Calcular promedio final si hay notas de los 3 trimestres
  for (const [inscripcionIdStr, notas] of Object.entries(porInscripcion)) {
    if (notas.length < 3) continue // No tiene todos los trimestres aún

    const inscripcionId = Number(inscripcionIdStr)
    const promedioFinal = notas.reduce((a, b) => a + b, 0) / notas.length
    const aprobado      = promedioFinal >= 51 // Ley 070: mínimo para aprobar

    await prisma.promedioFinal.upsert({
      where: {
        inscripcionId_docenteMateriaCursoId: {
          inscripcionId,
          docenteMateriaCursoId,
        },
      },
      update: { promedioFinal, aprobado },
      create: { inscripcionId, docenteMateriaCursoId, promedioFinal, aprobado },
    })
  }
}

// NUEVO endpoint — GET /api/calificaciones/:id/historial
// El Director puede ver todos los cambios de una calificación
export const getHistorialCalificacion = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const historial = await prisma.historialCalificacion.findMany({
      where:   { calificacionId: id },
      include: {
        usuario: { select: { id: true, username: true, rol: true } },
      },
      orderBy: { fecha: 'desc' },
    })

    res.status(200).json(historial)
  } catch (error) {
    console.error('[calificacion.getHistorialCalificacion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}