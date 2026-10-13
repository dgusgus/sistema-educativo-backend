import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'

import { asyncHandler } from '../lib/asyncHandler.js'
import { calcularPromediosFinales } from '../lib/promedio-final.helper.js'
import { calcularPendientesCierre, cerrarTrimestre as cerrarTrimestreService } from '../services/cierre-trimestre.service.js'
import { esDocenteDeAsignacion, miEstudianteId, puedeVerEstudiante } from '../lib/ownership.helper.js'

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
//
// IMPORTANTE: la corrección también actualiza el PromedioFinal de la materia
// (en la MISMA transacción). Antes solo cambiaba el promedio trimestral y el
// promedio final —que se escribe al cerrar el trimestre— quedaba con el valor
// viejo: boletines y resultado del año seguían mostrando la nota sin corregir.
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
  // Esta nota decide aprobar o reprobar: debe ser un número real en la escala 0-100.
  if (typeof promedioTrimestral !== 'number' || !Number.isFinite(promedioTrimestral)
      || promedioTrimestral < 0 || promedioTrimestral > 100) {
    res.status(400).json({ error: 'promedioTrimestral debe ser un número entre 0 y 100' })
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

    const { historial, calificacionActualizada } = await prisma.$transaction(async tx => {
      const historial = await tx.historialCalificacion.create({
        data: {
          promedioAnterior: calificacion.promedioTrimestral,
          promedioNuevo:    promedioTrimestral,
          motivo,
          usuarioId:        req.user!.id,
          calificacionId:   id,
        },
      })
      const calificacionActualizada = await tx.calificacion.update({ where: { id }, data: { promedioTrimestral } })

      // Mantiene PromedioFinal al día (si ya existen los 3 trimestres).
      await calcularPromediosFinales(calificacion.docenteMateriaCursoId, calificacion.trimestre.gestionId, tx)

      return { historial, calificacionActualizada }
    })

    res.status(200).json({ calificacion: calificacionActualizada, historial })
  } catch (error) {
    console.error('[calificacion.updateCalificacion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/trimestres/:id/cerrar ─────────────────────────────────────────
// La regla de completitud y el cierre viven en cierre-trimestre.service.ts.
export const cerrarTrimestre = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const trimestre = await cerrarTrimestreService(Number(req.params.id))
  res.status(200).json({
    message: `Trimestre "${trimestre.nombre}" cerrado correctamente`,
    trimestre,
  })
})

// ─── GET /api/trimestres/:id/pendientes ───────────────────────────────────────
// Vista de "qué falta para cerrar": MISMA función que usa el cierre, en modo
// solo-lectura y con nombres — alimenta el widget de pendientes del Dashboard.
export const getPendientesCierre = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  res.status(200).json(await calcularPendientesCierre(Number(req.params.id)))
})

// ─── GET /api/calificaciones/estudiante ──────────────────────────────────────
export const getCalificacionesEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { estudianteId, gestionId } = req.query as {
    estudianteId?: string
    gestionId?: string
  }

  try {
    // Si no mandan estudianteId, un ESTUDIANTE ve lo suyo (comportamiento
    // anterior, el frontend lo usa así). Cualquier otro caso lo exige.
    let estId: number | null = estudianteId !== undefined ? Number(estudianteId) : await miEstudianteId(req)

    if (estId === null) {
      res.status(400).json({ error: 'estudianteId es requerido' })
      return
    }
    if (!Number.isInteger(estId)) {
      res.status(400).json({ error: 'estudianteId inválido' })
      return
    }
    if (!(await puedeVerEstudiante(req, estId))) {
      res.status(403).json({ error: 'Sin permisos para ver este estudiante' })
      return
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