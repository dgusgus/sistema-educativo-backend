import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// ─── GET /api/asistencia ──────────────────────────────────────────────────────
// El docente consulta la lista de un día específico para registrar o revisar
// Query params: docenteMateriaCursoId, fecha (YYYY-MM-DD)
export const getAsistencia = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, fecha } = req.query as {
    docenteMateriaCursoId?: string
    fecha?: string
  }

  if (!docenteMateriaCursoId || !fecha) {
    res.status(400).json({
      error: 'docenteMateriaCursoId y fecha son obligatorios',
    })
    return
  }

  try {
    const dmcId = Number(docenteMateriaCursoId)

    // Verificar que el docente tiene acceso a esta asignación
    if (req.user?.rol === 'DOCENTE') {
      const docente = await prisma.docente.findFirst({
        where: { usuarioId: req.user.id },
      })
      if (!docente) {
        res.status(403).json({ error: 'Perfil de docente no encontrado' })
        return
      }

      const asignacion = await prisma.docenteMateriaCurso.findFirst({
        where: { id: dmcId, docenteId: docente.id },
      })
      if (!asignacion) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    // Obtener la asignación con sus datos
    const dmc = await prisma.docenteMateriaCurso.findUnique({
      where: { id: dmcId },
      include: {
        materia: { select: { id: true, nombre: true } },
        curso:   { select: { id: true, nombre: true } },
        gestion: { select: { id: true, anio: true } },
      },
    })

    if (!dmc) {
      res.status(404).json({ error: 'Asignación no encontrada' })
      return
    }

    // Obtener todos los estudiantes inscritos en el curso
    const inscripciones = await prisma.inscripcion.findMany({
      where: { cursoId: dmc.cursoId, gestionId: dmc.gestionId },
      include: {
        estudiante: {
          select: { id: true, nombre: true, apellido: true, ci: true },
        },
      },
      orderBy: { estudiante: { apellido: 'asc' } },
    })

    // Buscar registros de asistencia existentes para esa fecha
    const fechaDate = new Date(fecha)
    const asistenciasExistentes = await prisma.asistencia.findMany({
      where: {
        docenteMateriaCursoId: dmcId,
        fecha: {
          gte: new Date(fechaDate.setHours(0, 0, 0, 0)),
          lte: new Date(fechaDate.setHours(23, 59, 59, 999)),
        },
      },
    })

    // Combinar estudiantes con su estado de asistencia
    const lista = inscripciones.map(insc => {
      const asistencia = asistenciasExistentes.find(
        a => a.inscripcionId === insc.id
      )
      return {
        inscripcionId: insc.id,
        estudiante:    insc.estudiante,
        asistenciaId:  asistencia?.id ?? null,
        estado:        asistencia?.estado ?? null,
        justificacion: asistencia?.justificacion ?? null,
        registrado:    !!asistencia,
      }
    })

    res.status(200).json({
      dmc,
      fecha,
      totalEstudiantes: lista.length,
      yaRegistrado:     asistenciasExistentes.length > 0,
      lista,
    })
  } catch (error) {
    console.error('[asistencia.getAsistencia]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/asistencia ─────────────────────────────────────────────────────
// El docente registra la lista completa de un día
// Body: { docenteMateriaCursoId, fecha, registros: [{inscripcionId, estado, justificacion?}] }
export const registrarAsistencia = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, fecha, registros } = req.body as {
    docenteMateriaCursoId?: number
    fecha?: string
    registros?: Array<{
      inscripcionId: number
      estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
      justificacion?: string
    }>
  }

  if (!docenteMateriaCursoId || !fecha || !registros?.length) {
    res.status(400).json({
      error: 'docenteMateriaCursoId, fecha y registros son obligatorios',
    })
    return
  }

  // Validar estados
  const estadosValidos = ['PRESENTE', 'AUSENTE', 'JUSTIFICADO']
  const estadoInvalido = registros.find(r => !estadosValidos.includes(r.estado))
  if (estadoInvalido) {
    res.status(400).json({
      error: `Estado inválido: ${estadoInvalido.estado}. Usar: PRESENTE, AUSENTE o JUSTIFICADO`,
    })
    return
  }

  try {
    // Verificar acceso del docente
    if (req.user?.rol === 'DOCENTE') {
      const docente = await prisma.docente.findFirst({
        where: { usuarioId: req.user.id },
      })
      if (!docente) {
        res.status(403).json({ error: 'Perfil de docente no encontrado' })
        return
      }
      const asignacion = await prisma.docenteMateriaCurso.findFirst({
        where: { id: docenteMateriaCursoId, docenteId: docente.id },
      })
      if (!asignacion) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    // Verificar que no exista ya un registro para esa fecha y materia
    const fechaInicio = new Date(fecha)
    fechaInicio.setHours(0, 0, 0, 0)
    const fechaFin = new Date(fecha)
    fechaFin.setHours(23, 59, 59, 999)

    const yaExiste = await prisma.asistencia.findFirst({
      where: {
        docenteMateriaCursoId,
        fecha: { gte: fechaInicio, lte: fechaFin },
      },
    })
    if (yaExiste) {
      res.status(409).json({
        error: 'Ya existe un registro de asistencia para esta fecha y materia',
        sugerencia: 'Usa PUT /api/asistencia/:id para modificar registros existentes',
      })
      return
    }

    // Crear todos los registros en una sola transacción
    const fechaDate = new Date(fecha)

    const resultado = await prisma.$transaction(
      registros.map(r =>
        prisma.asistencia.create({
          data: {
            inscripcionId:         r.inscripcionId,
            docenteMateriaCursoId,
            fecha:                 fechaDate,
            estado:                r.estado,
            justificacion:         r.justificacion,
          },
        })
      )
    )

    // Calcular y actualizar resumen de asistencia
    await actualizarResumenAsistencia(docenteMateriaCursoId, registros.map(r => r.inscripcionId))

    // Verificar alertas de asistencia crítica (< 80%)
    const alertas = await verificarAlertasAsistencia(
      docenteMateriaCursoId,
      registros.map(r => r.inscripcionId)
    )

    res.status(201).json({
      registrados: resultado.length,
      fecha,
      alertas,
    })
  } catch (error) {
    console.error('[asistencia.registrarAsistencia]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/asistencia/:id ──────────────────────────────────────────────────
// Justificar o corregir una inasistencia ya registrada
export const actualizarAsistencia = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { estado, justificacion } = req.body as {
    estado?: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
    justificacion?: string
  }

  if (!estado) {
    res.status(400).json({ error: 'estado es obligatorio' })
    return
  }

  try {
    const asistencia = await prisma.asistencia.findUnique({
      where: { id },
      include: { docenteMateriaCurso: true },
    })

    if (!asistencia) {
      res.status(404).json({ error: 'Registro de asistencia no encontrado' })
      return
    }

    // Verificar acceso del docente
    if (req.user?.rol === 'DOCENTE') {
      const docente = await prisma.docente.findFirst({
        where: { usuarioId: req.user.id },
      })
      if (asistencia.docenteMateriaCurso.docenteId !== docente?.id) {
        res.status(403).json({ error: 'Solo puedes modificar tus propios registros' })
        return
      }
    }

    const updated = await prisma.asistencia.update({
      where: { id },
      data: { estado, justificacion },
    })

    // Recalcular resumen
    await actualizarResumenAsistencia(
      asistencia.docenteMateriaCursoId,
      [asistencia.inscripcionId]
    )

    res.status(200).json(updated)
  } catch (error) {
    console.error('[asistencia.actualizarAsistencia]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/asistencia/historial ───────────────────────────────────────────
// Estudiante o Tutor consultan el historial de asistencia
// Query params: estudianteId (opcional si es el propio estudiante)
export const getHistorial = async (req: Request, res: Response): Promise<void> => {
  const { estudianteId, docenteMateriaCursoId } = req.query as {
    estudianteId?: string
    docenteMateriaCursoId?: string
  }

  try {
    let inscripcionIds: number[] = []

    if (req.user?.rol === 'ESTUDIANTE') {
      // El estudiante solo ve sus propias inscripciones
      const estudiante = await prisma.estudiante.findFirst({
        where: { usuarioId: req.user.id },
      })
      if (!estudiante) {
        res.status(403).json({ error: 'Perfil de estudiante no encontrado' })
        return
      }
      const inscripciones = await prisma.inscripcion.findMany({
        where: { estudianteId: estudiante.id },
        select: { id: true },
      })
      inscripcionIds = inscripciones.map(i => i.id)

    } else if (req.user?.rol === 'TUTOR') {
      // El tutor ve las inscripciones de sus estudiantes vinculados
      const tutor = await prisma.tutor.findFirst({
        where: { usuarioId: req.user.id },
      })
      if (!tutor) {
        res.status(403).json({ error: 'Perfil de tutor no encontrado' })
        return
      }
      const vinculos = await prisma.tutorEstudiante.findMany({
        where: { tutorId: tutor.id },
        select: { estudianteId: true },
      })
      const estIds = vinculos.map(v => v.estudianteId)
      const inscripciones = await prisma.inscripcion.findMany({
        where: {
          estudianteId: { in: estIds },
          ...(estudianteId && { estudianteId: Number(estudianteId) }),
        },
        select: { id: true },
      })
      inscripcionIds = inscripciones.map(i => i.id)

    } else {
      // Director, Secretaria, Docente — pueden ver por estudianteId
      if (!estudianteId) {
        res.status(400).json({ error: 'estudianteId es requerido' })
        return
      }
      const inscripciones = await prisma.inscripcion.findMany({
        where: { estudianteId: Number(estudianteId) },
        select: { id: true },
      })
      inscripcionIds = inscripciones.map(i => i.id)
    }

    const asistencias = await prisma.asistencia.findMany({
      where: {
        inscripcionId: { in: inscripcionIds },
        ...(docenteMateriaCursoId && {
          docenteMateriaCursoId: Number(docenteMateriaCursoId),
        }),
      },
      include: {
        docenteMateriaCurso: {
          include: {
            materia: { select: { id: true, nombre: true } },
            curso:   { select: { id: true, nombre: true } },
          },
        },
      },
      orderBy: { fecha: 'desc' },
    })

    res.status(200).json(asistencias)
  } catch (error) {
    console.error('[asistencia.getHistorial]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/asistencia/resumen/:inscripcionId ───────────────────────────────
// % de asistencia por materia agrupado por trimestre
export const getResumen = async (req: Request, res: Response): Promise<void> => {
  const inscripcionId = Number(req.params.inscripcionId)

  try {
    const resumen = await prisma.resumenAsistencia.findMany({
      where: { inscripcionId },
      include: {
        docenteMateriaCurso: {
          include: {
            materia: { select: { id: true, nombre: true } },
            docente: { select: { id: true, nombre: true, apellido: true } },
          },
        },
        trimestre: { select: { id: true, numero: true, nombre: true } },
      },
      orderBy: [
        { trimestre: { numero: 'asc' } },
        { docenteMateriaCurso: { materia: { nombre: 'asc' } } },
      ],
    })

    // Si no hay resumen calculado, calcularlo al vuelo
    if (resumen.length === 0) {
      const calculado = await calcularResumenAlVuelo(inscripcionId)
      res.status(200).json(calculado)
      return
    }

    res.status(200).json(resumen)
  } catch (error) {
    console.error('[asistencia.getResumen]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/asistencia/reporte/:cursoId ────────────────────────────────────
// Director ve el reporte de asistencia consolidado del curso
export const getReporteCurso = async (req: Request, res: Response): Promise<void> => {
  const cursoId   = Number(req.params.cursoId)
  const gestionId = Number(req.query.gestionId as string)

  if (!gestionId) {
    res.status(400).json({ error: 'gestionId es obligatorio' })
    return
  }

  try {
    const inscripciones = await prisma.inscripcion.findMany({
      where: { cursoId, gestionId },
      include: {
        estudiante: { select: { id: true, nombre: true, apellido: true, ci: true } },
        resumenAsistencias: {
          include: {
            docenteMateriaCurso: {
              include: { materia: { select: { nombre: true } } },
            },
            trimestre: { select: { numero: true, nombre: true } },
          },
        },
      },
      orderBy: { estudiante: { apellido: 'asc' } },
    })

    // Calcular promedio general de asistencia por estudiante
    const reporte = inscripciones.map(insc => {
      const porcentajes = insc.resumenAsistencias.map(r => r.porcentaje)
      const promedioGeneral = porcentajes.length
        ? porcentajes.reduce((a, b) => a + b, 0) / porcentajes.length
        : 0

      return {
        estudiante:      insc.estudiante,
        inscripcionId:   insc.id,
        promedioGeneral: Math.round(promedioGeneral * 100) / 100,
        alertaCritica:   promedioGeneral < 80,
        detalleXMateria: insc.resumenAsistencias,
      }
    })

    res.status(200).json({
      cursoId,
      gestionId,
      totalEstudiantes: reporte.length,
      estudiantesEnRiesgo: reporte.filter(r => r.alertaCritica).length,
      reporte,
    })
  } catch (error) {
    console.error('[asistencia.getReporteCurso]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ══════════════════════════════════════
// FUNCIONES AUXILIARES
// ══════════════════════════════════════

// Recalcula el resumen de asistencia por trimestre
async function actualizarResumenAsistencia(
  docenteMateriaCursoId: number,
  inscripcionIds: number[]
) {
  const trimestres = await prisma.trimestre.findMany({
    where: {
      gestion: {
        cursos: {
          some: {
            asignaciones: { some: { id: docenteMateriaCursoId } },
          },
        },
      },
    },
  })

  for (const inscripcionId of inscripcionIds) {
    for (const trimestre of trimestres) {
      const registros = await prisma.asistencia.findMany({
        where: {
          inscripcionId,
          docenteMateriaCursoId,
          fecha: {
            gte: trimestre.fechaInicio ?? undefined,
            lte: trimestre.fechaFin   ?? undefined,
          },
        },
      })

      if (registros.length === 0) continue

      const totalClases      = registros.length
      const totalPresente    = registros.filter(r => r.estado === 'PRESENTE').length
      const totalAusente     = registros.filter(r => r.estado === 'AUSENTE').length
      const totalJustificado = registros.filter(r => r.estado === 'JUSTIFICADO').length
      const porcentaje       = ((totalPresente + totalJustificado) / totalClases) * 100

      await prisma.resumenAsistencia.upsert({
        where: {
          inscripcionId_docenteMateriaCursoId_trimestreId: {
            inscripcionId,
            docenteMateriaCursoId,
            trimestreId: trimestre.id,
          },
        },
        update: { totalClases, totalPresente, totalAusente, totalJustificado, porcentaje },
        create: {
          inscripcionId, docenteMateriaCursoId,
          trimestreId: trimestre.id,
          totalClases, totalPresente, totalAusente, totalJustificado, porcentaje,
        },
      })
    }
  }
}

// Detecta estudiantes con asistencia crítica (< 80%)
async function verificarAlertasAsistencia(
  docenteMateriaCursoId: number,
  inscripcionIds: number[]
) {
  const alertas: Array<{
    inscripcionId: number
    estudiante: string
    porcentaje: number
  }> = []

  for (const inscripcionId of inscripcionIds) {
    const registros = await prisma.asistencia.findMany({
      where: { inscripcionId, docenteMateriaCursoId },
      include: {
        inscripcion: {
          include: { estudiante: { select: { nombre: true, apellido: true } } },
        },
      },
    })

    if (registros.length === 0) continue

    const presentes = registros.filter(
      r => r.estado === 'PRESENTE' || r.estado === 'JUSTIFICADO'
    ).length
    const porcentaje = (presentes / registros.length) * 100

    if (porcentaje < 80) {
      const est = registros[0].inscripcion.estudiante
      alertas.push({
        inscripcionId,
        estudiante: `${est.nombre} ${est.apellido}`,
        porcentaje: Math.round(porcentaje * 100) / 100,
      })
    }
  }

  return alertas
}

// Calcula resumen al vuelo si no existe en la tabla
async function calcularResumenAlVuelo(inscripcionId: number) {
  const asistencias = await prisma.asistencia.findMany({
    where: { inscripcionId },
    include: {
      docenteMateriaCurso: {
        include: { materia: { select: { nombre: true } } },
      },
    },
  })

  const agrupado: Record<number, {
    materia: string
    total: number
    presente: number
    ausente: number
    justificado: number
    porcentaje: number
  }> = {}

  for (const a of asistencias) {
    const dmcId = a.docenteMateriaCursoId
    if (!agrupado[dmcId]) {
      agrupado[dmcId] = {
        materia:     a.docenteMateriaCurso.materia.nombre,
        total:       0,
        presente:    0,
        ausente:     0,
        justificado: 0,
        porcentaje:  0,
      }
    }
    agrupado[dmcId].total++
    if (a.estado === 'PRESENTE')    agrupado[dmcId].presente++
    if (a.estado === 'AUSENTE')     agrupado[dmcId].ausente++
    if (a.estado === 'JUSTIFICADO') agrupado[dmcId].justificado++
  }

  return Object.entries(agrupado).map(([dmcId, datos]) => ({
    docenteMateriaCursoId: Number(dmcId),
    ...datos,
    porcentaje: datos.total
      ? Math.round(((datos.presente + datos.justificado) / datos.total) * 10000) / 100
      : 0,
  }))
}