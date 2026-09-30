import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'

import { asyncHandler } from '../lib/asyncHandler.js'
import { esDocenteDeAsignacion } from '../lib/ownership.helper.js'

// ─── GET /api/calificaciones ──────────────────────────────────────────────────
// Planilla del docente: promedio ya calculado (ver evaluacion.controller.ts
// y calificacion.helper.ts para cómo se arma), con el desglose por dimensión.
export const getCalificaciones = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, trimestreId } = req.query as {
    docenteMateriaCursoId?: string
    trimestreId?: string
  }

  if (!docenteMateriaCursoId || !trimestreId) {
    res.status(400).json({ error: 'docenteMateriaCursoId y trimestreId son obligatorios' })
    return
  }

  const dmcId  = Number(docenteMateriaCursoId)
  const trimId = Number(trimestreId)
  if (!Number.isInteger(dmcId) || !Number.isInteger(trimId)) {
    res.status(400).json({ error: 'docenteMateriaCursoId y trimestreId deben ser números' })
    return
  }

  if (!await esDocenteDeAsignacion(req, dmcId)) {
    res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
    return
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

  const trimestre = await prisma.trimestre.findUnique({ where: { id: trimId } })
  if (!trimestre) {
    res.status(404).json({ error: 'Trimestre no encontrado' })
    return
  }

  const inscripciones = await prisma.inscripcion.findMany({
    where: { cursoId: dmc.cursoId, gestionId: dmc.gestionId },
    include: {
      estudiante: { select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } } },
      calificaciones: {
        where: { docenteMateriaCursoId: dmcId, trimestreId: trimId },
        include: { dimensiones: { include: { dimension: { select: { nombre: true } } } } },
      },
    },
    orderBy: { estudiante: { persona: { apellido: 'asc' } } },
  })

  const planilla = inscripciones.map(insc => {
    const cal = insc.calificaciones[0]
    return {
      inscripcionId:  insc.id,
      estudiante:     { id: insc.estudiante.id, ...insc.estudiante.persona },
      calificacionId: cal?.id ?? null,
      promedio:       cal?.promedioTrimestral ?? null,
      dimensiones:    cal?.dimensiones.map(d => ({ nombre: d.dimension.nombre, promedio: d.promedio })) ?? [],
      registrado:     cal?.promedioTrimestral != null,
    }
  })

  res.status(200).json({
    dmc,
    trimestre,
    trimestreCerrado: trimestre.cerrado,
    totalEstudiantes: planilla.length,
    notasRegistradas: planilla.filter(p => p.registrado).length,
    planilla,
  })
})

// ─── PUT /api/calificaciones/:id ──────────────────────────────────────────────
// Corrección MANUAL de un promedio ya calculado. Solo tiene sentido con
// el trimestre CERRADO — el comentario del schema es explícito: "una vez
// cerrado, cualquier corrección pasa por HistorialCalificacion, nunca un
// UPDATE directo". Mientras el trimestre está abierto, el promedio se
// corrige registrando/editando la NotaActividad correspondiente (POST
// /api/actividades-evaluativas/:id/notas), que dispara el recálculo
// automático — por eso este endpoint RECHAZA la edición si el trimestre
// sigue abierto (evita dos caminos distintos escribiendo el mismo campo).
export const updateCalificacion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { promedioTrimestral, motivo } = req.body as {
    promedioTrimestral?: number
    motivo?: string
  }

  if (promedioTrimestral === undefined) {
    res.status(400).json({ error: 'promedioTrimestral es obligatorio' })
    return
  }
  if (!motivo) {
    res.status(400).json({ error: 'motivo es obligatorio para una corrección manual' })
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

    if (!calificacion.trimestre.cerrado) {
      res.status(400).json({
        error: 'El trimestre está abierto — corrige la nota desde la actividad evaluativa (POST /api/actividades-evaluativas/:id/notas), no acá',
      })
      return
    }

    const [historial, calificacionActualizada] = await prisma.$transaction([
      prisma.historialCalificacion.create({
        data: {
          promedioAnterior: calificacion.promedioTrimestral,
          promedioNuevo:    promedioTrimestral,
          motivo,
          usuarioId:        req.user!.id,
          calificacionId:   id,
        },
      }),
      prisma.calificacion.update({ where: { id }, data: { promedioTrimestral } }),
    ])

    res.status(200).json({ calificacion: calificacionActualizada, historial })
  } catch (error) {
    console.error('[calificacion.updateCalificacion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/trimestres/:id/cerrar ─────────────────────────────────────────
export const cerrarTrimestre = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const trimestre = await prisma.trimestre.findUnique({ where: { id } })
    if (!trimestre) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }
    if (trimestre.cerrado) {
      res.status(400).json({ error: 'El trimestre ya está cerrado' })
      return
    }

    // Completitud: cada materia (DocenteMateriaCurso) de la gestión debe
    // tener un promedioTrimestral calculado para cada estudiante ACTIVO
    // inscrito en su curso.
    const dmcs = await prisma.docenteMateriaCurso.findMany({ where: { gestionId: trimestre.gestionId } })
    const incompletos: Array<{ docenteMateriaCursoId: number; faltantes: number }> = []

    for (const dmc of dmcs) {
      const inscripciones = await prisma.inscripcion.findMany({
        where: { cursoId: dmc.cursoId, gestionId: dmc.gestionId, estadoInscripcion: 'ACTIVA' },
        select: { id: true },
      })
      if (inscripciones.length === 0) continue

      const calificaciones = await prisma.calificacion.findMany({
        where: { docenteMateriaCursoId: dmc.id, trimestreId: id, promedioTrimestral: { not: null } },
        select: { inscripcionId: true },
      })
      const faltantes = inscripciones.filter(i => !calificaciones.some(c => c.inscripcionId === i.id))
      if (faltantes.length > 0) incompletos.push({ docenteMateriaCursoId: dmc.id, faltantes: faltantes.length })
    }

    if (incompletos.length > 0) {
      res.status(400).json({
        error: 'Hay materias con estudiantes sin promedio calculado en este trimestre',
        sugerencia: 'Registra todas las notas de actividades pendientes antes de cerrar',
        incompletos,
      })
      return
    }

    const trimCerrado = await prisma.trimestre.update({ where: { id }, data: { cerrado: true } })

    // Al cerrar, recalcular promedios finales de todas las materias de la
    // gestión (solo se materializan cuando existe nota de TODOS los
    // trimestres de la gestión — ver calcularPromediosFinales).
    for (const dmc of dmcs) {
      await calcularPromediosFinales(dmc.id, trimestre.gestionId)
    }

    res.status(200).json({
      message: `Trimestre "${trimestre.nombre}" cerrado correctamente`,
      trimestre: trimCerrado,
    })
  } catch (error) {
    console.error('[calificacion.cerrarTrimestre]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/trimestres/:id/pendientes ───────────────────────────────────────
// Vista de "qué falta para cerrar": MISMA regla de completitud que
// cerrarTrimestre (cada DocenteMateriaCurso debe tener promedioTrimestral
// para cada estudiante ACTIVO de su curso), pero en modo solo-lectura y con
// nombres — alimenta el widget de pendientes del Dashboard. No escribe nada.
export const getPendientesCierre = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const trimestre = await prisma.trimestre.findUnique({
      where: { id },
      select: { id: true, numero: true, nombre: true, cerrado: true, gestionId: true },
    })
    if (!trimestre) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }

    const dmcs = await prisma.docenteMateriaCurso.findMany({
      where: { gestionId: trimestre.gestionId },
      select: {
        id: true,
        cursoId: true,
        materia: { select: { nombre: true, codigo: true } },
        curso:   { select: { grado: true, paralelo: true, nivel: true } },
        docente: { select: { persona: { select: { nombre: true, apellido: true } } } },
      },
      orderBy: { cursoId: 'asc' },
    })

    const pendientes = []
    let totalEsperados = 0
    let totalRegistrados = 0

    for (const dmc of dmcs) {
      const inscripciones = await prisma.inscripcion.findMany({
        where: { cursoId: dmc.cursoId, gestionId: trimestre.gestionId, estadoInscripcion: 'ACTIVA' },
        select: { id: true, estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } },
      })
      if (inscripciones.length === 0) continue

      const calificaciones = await prisma.calificacion.findMany({
        where: { docenteMateriaCursoId: dmc.id, trimestreId: id, promedioTrimestral: { not: null } },
        select: { inscripcionId: true },
      })
      const conNota = new Set(calificaciones.map(c => c.inscripcionId))
      const faltantes = inscripciones
        .filter(i => !conNota.has(i.id))
        .map(i => ({
          inscripcionId: i.id,
          nombreCompleto: `${i.estudiante.persona.apellido} ${i.estudiante.persona.nombre}`,
        }))

      totalEsperados   += inscripciones.length
      totalRegistrados += inscripciones.length - faltantes.length

      pendientes.push({
        docenteMateriaCursoId: dmc.id,
        materia:  dmc.materia,
        curso:    dmc.curso,
        docente:  `${dmc.docente.persona.apellido} ${dmc.docente.persona.nombre}`,
        totalEsperados: inscripciones.length,
        registrados:    inscripciones.length - faltantes.length,
        faltantes,
      })
    }

    res.status(200).json({
      trimestre,
      resumen: {
        totalMaterias:     pendientes.length,
        materiasCompletas: pendientes.filter(p => p.faltantes.length === 0).length,
        totalEsperados,
        totalRegistrados,
        totalFaltantes: totalEsperados - totalRegistrados,
      },
      pendientes,
    })
  } catch (error) {
    console.error('[calificacion.getPendientesCierre]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/calificaciones/estudiante ──────────────────────────────────────
export const getCalificacionesEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { estudianteId, gestionId } = req.query as {
    estudianteId?: string
    gestionId?: string
  }

  try {
    let estId: number
    const soloFamilia = req.user ? req.user.roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r)) : false

    if (soloFamilia && req.user!.roles.includes('ESTUDIANTE')) {
      const estudiante = await prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id } })
      if (!estudiante) {
        res.status(403).json({ error: 'Perfil de estudiante no encontrado' })
        return
      }
      estId = estudiante.id

    } else if (soloFamilia && req.user!.roles.includes('TUTOR')) {
      if (!estudianteId) {
        res.status(400).json({ error: 'estudianteId es requerido' })
        return
      }
      const tutor = await prisma.tutor.findFirst({ where: { usuarioId: req.user!.id } })
      const vinculo = await prisma.tutorEstudiante.findFirst({ where: { tutorId: tutor?.id, estudianteId: Number(estudianteId) } })
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

    const inscripciones = await prisma.inscripcion.findMany({
      where: { estudianteId: estId, ...(gestionId && { gestionId: Number(gestionId) }) },
      include: {
        curso:   { select: { nivel: true, grado: true, paralelo: true } },
        gestion: { select: { anio: true } },
        calificaciones: {
          include: {
            docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } },
            trimestre: { select: { numero: true, nombre: true } },
            dimensiones: { include: { dimension: { select: { nombre: true } } } },
          },
          orderBy: [{ trimestre: { numero: 'asc' } }],
        },
        promediosFinales: {
          include: { docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } } },
        },
      },
    })

    res.status(200).json(inscripciones)
  } catch (error) {
    console.error('[calificacion.getCalificacionesEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/calificaciones/:id/historial ───────────────────────────────────
export const getHistorialCalificacion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const historial = await prisma.historialCalificacion.findMany({
      where:   { calificacionId: id },
      include: { usuario: { select: { id: true, username: true, roles: true } } },
      orderBy: { fecha: 'desc' },
    })

    res.status(200).json(historial)
  } catch (error) {
    console.error('[calificacion.getHistorialCalificacion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ══════════════════════════════════════
// FUNCIÓN AUXILIAR
// ══════════════════════════════════════

// ÚNICO escritor de PromedioFinal. Se llama al cerrar cada trimestre;
// solo materializa el promedio cuando YA hay promedioTrimestral de TODOS
// los trimestres de la gestión (antes era un "3" fijo — ahora se cuenta
// dinámicamente, porque el número de trimestres es configurable).
async function calcularPromediosFinales(docenteMateriaCursoId: number, gestionId: number) {
  const totalTrimestres = await prisma.trimestre.count({ where: { gestionId } })

  const gestion = await prisma.gestion.findUniqueOrThrow({
    where: { id: gestionId }, select: { notaMinimaAprobacion: true },
  })
  const notaMinima = Number(gestion.notaMinimaAprobacion)

  const calificaciones = await prisma.calificacion.findMany({
    where: { docenteMateriaCursoId, promedioTrimestral: { not: null } },
  })

  const porInscripcion: Record<number, number[]> = {}
  for (const cal of calificaciones) {
    (porInscripcion[cal.inscripcionId] ??= []).push(Number(cal.promedioTrimestral))
  }

  for (const [inscripcionIdStr, promedios] of Object.entries(porInscripcion)) {
    if (promedios.length < totalTrimestres) continue // faltan trimestres

    const inscripcionId  = Number(inscripcionIdStr)
    const promedioFinal  = promedios.reduce((a, b) => a + b, 0) / promedios.length
    const resultado: 'PROMOVIDO' | 'REPROBADO' = promedioFinal >= notaMinima ? 'PROMOVIDO' : 'REPROBADO'

    await prisma.promedioFinal.upsert({
      where: { inscripcionId_docenteMateriaCursoId: { inscripcionId, docenteMateriaCursoId } },
      update: { promedioFinal, resultado },
      create: { inscripcionId, docenteMateriaCursoId, promedioFinal, resultado },
    })
  }
}