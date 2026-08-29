import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { validarContextoAcademicoLote } from '../lib/contexto-academico.helper.js'

const ESTADOS_VALIDOS = ['PRESENTE', 'AUSENTE', 'RETRASO', 'JUSTIFICADO']

// ─── GET /api/asistencia ──────────────────────────────────────────────────────
// Query params: docenteMateriaCursoId, fecha (YYYY-MM-DD)
export const getAsistencia = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, fecha } = req.query as {
    docenteMateriaCursoId?: string
    fecha?: string
  }

  if (!docenteMateriaCursoId || !fecha) {
    res.status(400).json({ error: 'docenteMateriaCursoId y fecha son obligatorios' })
    return
  }

  try {
    const dmcId = Number(docenteMateriaCursoId)

    if (req.user?.roles.includes('DOCENTE') && !req.user.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))) {
      const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user.id } })
      if (!docente) {
        res.status(403).json({ error: 'Perfil de docente no encontrado' })
        return
      }
      const asignacion = await prisma.docenteMateriaCurso.findFirst({ where: { id: dmcId, docenteId: docente.id } })
      if (!asignacion) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    const dmc = await prisma.docenteMateriaCurso.findUnique({
      where: { id: dmcId },
      include: {
        materia: { select: { id: true, nombre: true } },
        curso:   { select: { id: true, nivel: true, grado: true, paralelo: true } },
        gestion: { select: { id: true, anio: true } },
      },
    })

    if (!dmc) {
      res.status(404).json({ error: 'Asignación no encontrada' })
      return
    }

    const inscripciones = await prisma.inscripcion.findMany({
      where: { cursoId: dmc.cursoId, gestionId: dmc.gestionId },
      include: { estudiante: { select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } } } },
      orderBy: { estudiante: { persona: { apellido: 'asc' } } },
    })

    const fechaDate = new Date(fecha)
    const inicioDia = new Date(fechaDate); inicioDia.setHours(0, 0, 0, 0)
    const finDia    = new Date(fechaDate); finDia.setHours(23, 59, 59, 999)

    const asistenciasExistentes = await prisma.asistencia.findMany({
      where: { docenteMateriaCursoId: dmcId, fecha: { gte: inicioDia, lte: finDia } },
    })

    const lista = inscripciones.map(insc => {
      const asistencia = asistenciasExistentes.find(a => a.inscripcionId === insc.id)
      return {
        inscripcionId: insc.id,
        estudiante:    { id: insc.estudiante.id, ...insc.estudiante.persona },
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
// El docente registra la lista completa de un día.
// v6 agrega trimestreId como campo OBLIGATORIO de Asistencia (antes se
// inferría comparando `fecha` contra el rango del trimestre) — ahora hay
// que enviarlo explícito y se valida contra el invariante de contexto
// académico (inscripción + asignación + trimestre, misma gestión).
// Body: { docenteMateriaCursoId, trimestreId, fecha, registros: [{inscripcionId, estado, justificacion?}] }
export const registrarAsistencia = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, trimestreId, fecha, registros } = req.body as {
    docenteMateriaCursoId?: number
    trimestreId?: number
    fecha?: string
    registros?: Array<{
      inscripcionId: number
      estado: 'PRESENTE' | 'AUSENTE' | 'RETRASO' | 'JUSTIFICADO'
      justificacion?: string
    }>
  }

  if (!docenteMateriaCursoId || !trimestreId || !fecha || !registros?.length) {
    res.status(400).json({ error: 'docenteMateriaCursoId, trimestreId, fecha y registros son obligatorios' })
    return
  }

  const estadoInvalido = registros.find(r => !ESTADOS_VALIDOS.includes(r.estado))
  if (estadoInvalido) {
    res.status(400).json({ error: `Estado inválido: ${estadoInvalido.estado}. Usar: ${ESTADOS_VALIDOS.join(', ')}` })
    return
  }

  try {
    if (req.user?.roles.includes('DOCENTE') && !req.user.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))) {
      const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user.id } })
      if (!docente) {
        res.status(403).json({ error: 'Perfil de docente no encontrado' })
        return
      }
      const asignacion = await prisma.docenteMateriaCurso.findFirst({ where: { id: docenteMateriaCursoId, docenteId: docente.id } })
      if (!asignacion) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    const { invalidas, error: errorContexto } = await validarContextoAcademicoLote(
      registros.map(r => r.inscripcionId), docenteMateriaCursoId, trimestreId
    )
    if (errorContexto) {
      res.status(400).json({ error: errorContexto })
      return
    }
    if (invalidas.length > 0) {
      res.status(400).json({
        error: 'Alguna(s) inscripción(es) no pertenecen al curso/gestión de esta asignación o trimestre',
        inscripcionesInvalidas: invalidas,
      })
      return
    }

    const fechaInicio = new Date(fecha); fechaInicio.setHours(0, 0, 0, 0)
    const fechaFin    = new Date(fecha); fechaFin.setHours(23, 59, 59, 999)

    const yaExiste = await prisma.asistencia.findFirst({
      where: { docenteMateriaCursoId, fecha: { gte: fechaInicio, lte: fechaFin } },
    })
    if (yaExiste) {
      res.status(409).json({
        error: 'Ya existe un registro de asistencia para esta fecha y materia',
        sugerencia: 'Usa PUT /api/asistencia/:id para modificar registros existentes',
      })
      return
    }

    const fechaDate = new Date(fecha)

    const resultado = await prisma.$transaction(
      registros.map(r =>
        prisma.asistencia.create({
          data: {
            inscripcionId: r.inscripcionId,
            docenteMateriaCursoId,
            trimestreId,
            fecha: fechaDate,
            estado: r.estado,
            justificacion: r.justificacion,
          },
        })
      )
    )

    await actualizarResumenAsistencia(docenteMateriaCursoId, trimestreId, registros.map(r => r.inscripcionId))
    const alertas = await verificarAlertasAsistencia(docenteMateriaCursoId, trimestreId, registros.map(r => r.inscripcionId))

    res.status(201).json({ registrados: resultado.length, fecha, alertas })
  } catch (error) {
    console.error('[asistencia.registrarAsistencia]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/asistencia/:id ──────────────────────────────────────────────────
export const actualizarAsistencia = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { estado, justificacion } = req.body as {
    estado?: 'PRESENTE' | 'AUSENTE' | 'RETRASO' | 'JUSTIFICADO'
    justificacion?: string
  }

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    res.status(400).json({ error: `estado es obligatorio. Usar: ${ESTADOS_VALIDOS.join(', ')}` })
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

    if (req.user?.roles.includes('DOCENTE') && !req.user.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))) {
      const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user.id } })
      if (asistencia.docenteMateriaCurso.docenteId !== docente?.id) {
        res.status(403).json({ error: 'Solo puedes modificar tus propios registros' })
        return
      }
    }

    const updated = await prisma.asistencia.update({ where: { id }, data: { estado, justificacion } })

    await actualizarResumenAsistencia(asistencia.docenteMateriaCursoId, asistencia.trimestreId, [asistencia.inscripcionId])

    res.status(200).json(updated)
  } catch (error) {
    console.error('[asistencia.actualizarAsistencia]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/asistencia/historial ───────────────────────────────────────────
export const getHistorial = async (req: Request, res: Response): Promise<void> => {
  const { estudianteId, docenteMateriaCursoId } = req.query as {
    estudianteId?: string
    docenteMateriaCursoId?: string
  }

  try {
    let inscripcionIds: number[] = []
    const soloFamilia = req.user ? req.user.roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r)) : false

    if (soloFamilia && req.user!.roles.includes('ESTUDIANTE')) {
      const estudiante = await prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id } })
      if (!estudiante) {
        res.status(403).json({ error: 'Perfil de estudiante no encontrado' })
        return
      }
      const inscripciones = await prisma.inscripcion.findMany({ where: { estudianteId: estudiante.id }, select: { id: true } })
      inscripcionIds = inscripciones.map(i => i.id)

    } else if (soloFamilia && req.user!.roles.includes('TUTOR')) {
      const tutor = await prisma.tutor.findFirst({ where: { usuarioId: req.user!.id } })
      if (!tutor) {
        res.status(403).json({ error: 'Perfil de tutor no encontrado' })
        return
      }
      const vinculos = await prisma.tutorEstudiante.findMany({ where: { tutorId: tutor.id }, select: { estudianteId: true } })
      const estIds = vinculos.map(v => v.estudianteId)
      const inscripciones = await prisma.inscripcion.findMany({
        where: { estudianteId: { in: estIds }, ...(estudianteId && { estudianteId: Number(estudianteId) }) },
        select: { id: true },
      })
      inscripcionIds = inscripciones.map(i => i.id)

    } else {
      if (!estudianteId) {
        res.status(400).json({ error: 'estudianteId es requerido' })
        return
      }
      const inscripciones = await prisma.inscripcion.findMany({ where: { estudianteId: Number(estudianteId) }, select: { id: true } })
      inscripcionIds = inscripciones.map(i => i.id)
    }

    const asistencias = await prisma.asistencia.findMany({
      where: {
        inscripcionId: { in: inscripcionIds },
        ...(docenteMateriaCursoId && { docenteMateriaCursoId: Number(docenteMateriaCursoId) }),
      },
      include: {
        docenteMateriaCurso: {
          include: {
            materia: { select: { id: true, nombre: true } },
            curso:   { select: { id: true, nivel: true, grado: true, paralelo: true } },
          },
        },
        trimestre: { select: { id: true, numero: true, nombre: true } },
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
export const getResumen = async (req: Request, res: Response): Promise<void> => {
  const inscripcionId = Number(req.params.inscripcionId)

  try {
    const resumen = await prisma.resumenAsistencia.findMany({
      where: { inscripcionId },
      include: {
        docenteMateriaCurso: {
          include: {
            materia: { select: { id: true, nombre: true } },
            docente: { select: { id: true, persona: { select: { nombre: true, apellido: true } } } },
          },
        },
        trimestre: { select: { id: true, numero: true, nombre: true } },
      },
      orderBy: [
        { trimestre: { numero: 'asc' } },
        { docenteMateriaCurso: { materia: { nombre: 'asc' } } },
      ],
    })

    if (resumen.length === 0) {
      const calculado = await calcularResumenAlVuelo(inscripcionId)
      res.status(200).json(calculado)
      return
    }

    res.status(200).json(resumen.map(r => ({
      ...r,
      docenteMateriaCurso: { ...r.docenteMateriaCurso, docente: aplanarPersona(r.docenteMateriaCurso.docente) },
    })))
  } catch (error) {
    console.error('[asistencia.getResumen]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/asistencia/reporte/:cursoId ────────────────────────────────────
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
        estudiante: { select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } } },
        resumenAsistencias: {
          include: {
            docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } },
            trimestre: { select: { numero: true, nombre: true } },
          },
        },
      },
      orderBy: { estudiante: { persona: { apellido: 'asc' } } },
    })

    const reporte = inscripciones.map(insc => {
      const porcentajes = insc.resumenAsistencias.map(r => r.porcentaje)
      const promedioGeneral = porcentajes.length
        ? porcentajes.reduce((a, b) => Number(a) + Number(b), 0) / porcentajes.length
        : 0

      return {
        estudiante:      { id: insc.estudiante.id, ...insc.estudiante.persona },
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

// v6: trimestreId ya viene guardado en cada Asistencia — ya no hace
// falta buscar el trimestre por rango de fechas, solo agrupar por él.
// ÚNICO escritor de ResumenAsistencia (ver comentario del schema).
async function actualizarResumenAsistencia(
  docenteMateriaCursoId: number,
  trimestreId: number,
  inscripcionIds: number[]
) {
  for (const inscripcionId of inscripcionIds) {
    const registros = await prisma.asistencia.findMany({
      where: { inscripcionId, docenteMateriaCursoId, trimestreId },
    })
    if (registros.length === 0) continue

    const totalClases      = registros.length
    const totalPresente    = registros.filter(r => r.estado === 'PRESENTE').length
    const totalAusente     = registros.filter(r => r.estado === 'AUSENTE').length
    const totalRetraso     = registros.filter(r => r.estado === 'RETRASO').length
    const totalJustificado = registros.filter(r => r.estado === 'JUSTIFICADO').length
    // RETRASO no cuenta como presente para el % — es una falta parcial
    const porcentaje = ((totalPresente + totalJustificado) / totalClases) * 100

    await prisma.resumenAsistencia.upsert({
      where: {
        inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId, docenteMateriaCursoId, trimestreId },
      },
      update: { totalClases, totalPresente, totalAusente, totalRetraso, totalJustificado, porcentaje },
      create: {
        inscripcionId, docenteMateriaCursoId, trimestreId,
        totalClases, totalPresente, totalAusente, totalRetraso, totalJustificado, porcentaje,
      },
    })
  }
}

async function verificarAlertasAsistencia(
  docenteMateriaCursoId: number,
  trimestreId: number,
  inscripcionIds: number[]
) {
  const alertas: Array<{ inscripcionId: number; estudiante: string; porcentaje: number }> = []

  for (const inscripcionId of inscripcionIds) {
    const registros = await prisma.asistencia.findMany({
      where: { inscripcionId, docenteMateriaCursoId, trimestreId },
      include: { inscripcion: { include: { estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } } } },
    })

    if (registros.length === 0) continue

    const presentes = registros.filter(r => r.estado === 'PRESENTE' || r.estado === 'JUSTIFICADO').length
    const porcentaje = (presentes / registros.length) * 100

    if (porcentaje < 80) {
      const persona = registros[0].inscripcion.estudiante.persona
      alertas.push({
        inscripcionId,
        estudiante: `${persona.nombre} ${persona.apellido}`,
        porcentaje: Math.round(porcentaje * 100) / 100,
      })
    }
  }

  return alertas
}

async function calcularResumenAlVuelo(inscripcionId: number) {
  const asistencias = await prisma.asistencia.findMany({
    where: { inscripcionId },
    include: { docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } } },
  })

  const agrupado: Record<number, {
    materia: string; total: number; presente: number; ausente: number; retraso: number; justificado: number; porcentaje: number
  }> = {}

  for (const a of asistencias) {
    const dmcId = a.docenteMateriaCursoId
    if (!agrupado[dmcId]) {
      agrupado[dmcId] = { materia: a.docenteMateriaCurso.materia.nombre, total: 0, presente: 0, ausente: 0, retraso: 0, justificado: 0, porcentaje: 0 }
    }
    agrupado[dmcId].total++
    if (a.estado === 'PRESENTE')    agrupado[dmcId].presente++
    if (a.estado === 'AUSENTE')     agrupado[dmcId].ausente++
    if (a.estado === 'RETRASO')     agrupado[dmcId].retraso++
    if (a.estado === 'JUSTIFICADO') agrupado[dmcId].justificado++
  }

  return Object.entries(agrupado).map(([dmcId, datos]) => ({
    docenteMateriaCursoId: Number(dmcId),
    ...datos,
    porcentaje: datos.total ? Math.round(((datos.presente + datos.justificado) / datos.total) * 10000) / 100 : 0,
  }))
}