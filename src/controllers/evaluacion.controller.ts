// src/controllers/evaluacion.controller.ts
//
// ARCHIVO NUEVO — no existía en el proyecto original. Cubre la parte
// del modelo v6 que no tenía equivalente antes: cómo se arma una nota
// (DimensionEvaluacion, ActividadEvaluativa, NotaActividad). La consulta
// de resultados ya calculados (planilla, cierre de trimestre, historial)
// se queda en calificacion.controller.ts.

import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { recalcularCalificacion } from '../lib/calificacion.helper.js'

// ─── GET /api/dimensiones?gestionId= ──────────────────────────────────────────
export const getDimensiones = async (req: Request, res: Response): Promise<void> => {
  const { gestionId } = req.query as { gestionId?: string }
  if (!gestionId) {
    res.status(400).json({ error: 'gestionId es obligatorio' })
    return
  }
  try {
    const dimensiones = await prisma.dimensionEvaluacion.findMany({
      where:   { gestionId: Number(gestionId) },
      orderBy: { orden: 'asc' },
    })
    res.status(200).json(dimensiones)
  } catch (error) {
    console.error('[evaluacion.getDimensiones]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/dimensiones ────────────────────────────────────────────────────
// Solo Director/Secretaria — define las dimensiones de evaluación de la
// gestión (ej. Ser 5%, Saber 45%, Hacer 40%, Decidir 10%, según la Ley
// 070, pero configurable).
export const createDimension = async (req: Request, res: Response): Promise<void> => {
  const { gestionId, nombre, puntajeMaximo, pesoEnPromedio, orden, esAutoevaluada } = req.body as {
    gestionId?: number
    nombre?: string
    puntajeMaximo?: number
    pesoEnPromedio?: number
    orden?: number
    esAutoevaluada?: boolean
  }

  if (!gestionId || !nombre || puntajeMaximo === undefined) {
    res.status(400).json({ error: 'gestionId, nombre y puntajeMaximo son obligatorios' })
    return
  }

  try {
    const existe = await prisma.dimensionEvaluacion.findUnique({
      where: { gestionId_nombre: { gestionId, nombre } },
    })
    if (existe) {
      res.status(409).json({ error: `Ya existe la dimensión "${nombre}" en esta gestión` })
      return
    }

    const dimension = await prisma.dimensionEvaluacion.create({
      data: {
        gestionId, nombre, puntajeMaximo,
        pesoEnPromedio: pesoEnPromedio ?? 1,
        orden:          orden ?? 0,
        esAutoevaluada: esAutoevaluada ?? false,
      },
    })
    res.status(201).json(dimension)
  } catch (error) {
    console.error('[evaluacion.createDimension]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/actividades-evaluativas ─────────────────────────────────────────
// Query: docenteMateriaCursoId, trimestreId
export const getActividadesEvaluativas = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, trimestreId } = req.query as {
    docenteMateriaCursoId?: string
    trimestreId?: string
  }
  if (!docenteMateriaCursoId || !trimestreId) {
    res.status(400).json({ error: 'docenteMateriaCursoId y trimestreId son obligatorios' })
    return
  }

  try {
    const actividades = await prisma.actividadEvaluativa.findMany({
      where: {
        docenteMateriaCursoId: Number(docenteMateriaCursoId),
        trimestreId:           Number(trimestreId),
        activo: true,
      },
      include: {
        dimension: { select: { id: true, nombre: true } },
        _count:    { select: { notas: true } },
      },
      orderBy: { fecha: 'asc' },
    })
    res.status(200).json(actividades)
  } catch (error) {
    console.error('[evaluacion.getActividadesEvaluativas]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/actividades-evaluativas ────────────────────────────────────────
// El docente crea una actividad evaluable (ej. "Examen parcial",
// "Exposición") dentro de una dimensión.
export const createActividadEvaluativa = async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, trimestreId, dimensionId, nombre, fecha, puntajeMaximo, peso, esRecuperatorio } =
    req.body as {
      docenteMateriaCursoId?: number
      trimestreId?: number
      dimensionId?: number
      nombre?: string
      fecha?: string
      puntajeMaximo?: number
      peso?: number
      esRecuperatorio?: boolean
    }

  if (!docenteMateriaCursoId || !trimestreId || !dimensionId || !nombre || puntajeMaximo === undefined) {
    res.status(400).json({
      error: 'docenteMateriaCursoId, trimestreId, dimensionId, nombre y puntajeMaximo son obligatorios',
    })
    return
  }

  try {
    if (req.user?.roles.includes('DOCENTE') && !req.user.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))) {
      const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user.id } })
      const asignacion = await prisma.docenteMateriaCurso.findFirst({
        where: { id: docenteMateriaCursoId, docenteId: docente?.id },
      })
      if (!asignacion) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    const trimestre = await prisma.trimestre.findUnique({ where: { id: trimestreId } })
    if (!trimestre) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }
    if (trimestre.cerrado) {
      res.status(403).json({ error: 'El trimestre está cerrado' })
      return
    }

    const actividad = await prisma.actividadEvaluativa.create({
      data: {
        docenteMateriaCursoId, trimestreId, dimensionId, nombre,
        fecha: fecha ? new Date(fecha) : new Date(),
        puntajeMaximo,
        peso: peso ?? 1,
        esRecuperatorio: esRecuperatorio ?? false,
      },
      include: { dimension: { select: { nombre: true } } },
    })
    res.status(201).json(actividad)
  } catch (error) {
    console.error('[evaluacion.createActividadEvaluativa]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── DELETE /api/actividades-evaluativas/:id ─────────────────────────────────
// Baja lógica (activo: false) — nunca se borra físicamente porque ya
// puede tener NotaActividad asociadas que sustentan un promedio.
export const desactivarActividadEvaluativa = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const actividad = await prisma.actividadEvaluativa.update({
      where: { id },
      data:  { activo: false },
    })
    res.status(200).json({ message: 'Actividad evaluativa desactivada', actividad })
  } catch (error) {
    console.error('[evaluacion.desactivarActividadEvaluativa]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/actividades-evaluativas/:id/notas ─────────────────────────────
// El docente registra las notas de toda una actividad de una sola vez.
// Dispara recalcularCalificacion() para cada estudiante afectado.
// Body: { notas: [{ inscripcionId, nota, observacion? }] }
export const registrarNotasActividad = async (req: Request, res: Response): Promise<void> => {
  const actividadEvaluativaId = Number(req.params.id)
  const { notas } = req.body as {
    notas?: Array<{ inscripcionId: number; nota: number; observacion?: string }>
  }

  if (!notas?.length) {
    res.status(400).json({ error: 'notas es obligatorio' })
    return
  }

  try {
    const actividad = await prisma.actividadEvaluativa.findUnique({
      where: { id: actividadEvaluativaId },
      include: { trimestre: true, docenteMateriaCurso: true },
    })
    if (!actividad) {
      res.status(404).json({ error: 'Actividad evaluativa no encontrada' })
      return
    }
    if (actividad.trimestre.cerrado) {
      res.status(403).json({ error: 'El trimestre está cerrado — no se pueden modificar notas' })
      return
    }

    if (req.user?.roles.includes('DOCENTE') && !req.user.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))) {
      const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user.id } })
      if (actividad.docenteMateriaCurso.docenteId !== docente?.id) {
        res.status(403).json({ error: 'Sin acceso a esta materia/curso' })
        return
      }
    }

    const notaInvalida = notas.find(n => n.nota < 0 || n.nota > Number(actividad.puntajeMaximo))
    if (notaInvalida) {
      res.status(400).json({
        error: `Nota inválida: ${notaInvalida.nota}. El máximo de esta actividad es ${actividad.puntajeMaximo}`,
      })
      return
    }

    await prisma.$transaction(
      notas.map(n =>
        prisma.notaActividad.upsert({
          where: { actividadEvaluativaId_inscripcionId: { actividadEvaluativaId, inscripcionId: n.inscripcionId } },
          update: { nota: n.nota, observacion: n.observacion, registradoPorId: req.user?.id },
          create: {
            actividadEvaluativaId, inscripcionId: n.inscripcionId,
            nota: n.nota, observacion: n.observacion, registradoPorId: req.user?.id,
          },
        })
      )
    )

    const resultados = []
    for (const n of notas) {
      const calificacion = await recalcularCalificacion(
        n.inscripcionId, actividad.docenteMateriaCursoId, actividad.trimestreId
      )
      resultados.push({ inscripcionId: n.inscripcionId, promedioTrimestral: calificacion.promedioTrimestral })
    }

    res.status(200).json({ registradas: notas.length, resultados })
  } catch (error) {
    console.error('[evaluacion.registrarNotasActividad]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}