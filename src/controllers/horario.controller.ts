// src/controllers/horario.controller.ts
//
// Módulo de Horarios (OE6) — HU-12 (crear), HU-13 (detección de
// conflictos), HU-14 (consulta para Docente/Estudiante/Tutor).
//
// LECTURA PÚBLICA: cualquier usuario autenticado puede consultar
// cualquier horario (por curso, docente o asignación). La restricción
// vive solo en la escritura (DIRECTOR/SECRETARIA en horario.routes.ts).
// Las ramas de estudiante/tutor sin parámetros son una comodidad
// (resuelven su propio curso), no una restricción.

import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import type { DiaSemana } from '../../prisma/generated/prisma/enums.js'

// horaInicio/horaFin son @db.Time en Postgres — Prisma los representa
// como Date completo, pero solo importa la parte de hora. Se ancla
// siempre al mismo día epoch para que comparar rangos sea puramente
// sobre la hora, sin arrastrar una fecha real.
function aHora(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`)
}
function aTexto(fecha: Date): string {
  return fecha.toISOString().slice(11, 16) // "HH:mm"
}

// Dos bloques se solapan si el inicio de uno cae antes del fin del
// otro y viceversa.
function seSolapan(inicioA: Date, finA: Date, inicioB: Date, finB: Date): boolean {
  return inicioA < finB && inicioB < finA
}

interface HorarioInput {
  docenteMateriaCursoId?: number
  diaSemana?:  DiaSemana
  horaInicio?: string // "HH:mm"
  horaFin?:    string // "HH:mm"
  aula?:       string
}

const DIAS_VALIDOS: DiaSemana[] = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO']

// Único punto por el que pasa la validación de conflicto, tanto al
// crear como al editar. `excluirId` evita que un horario choque
// consigo mismo al guardarse una edición que no le cambia el bloque.
async function buscarConflicto(
  dmc: { docenteId: number; cursoId: number; gestionId: number },
  diaSemana: DiaSemana,
  horaInicio: Date,
  horaFin: Date,
  excluirId?: number
): Promise<{ tipo: 'DOCENTE' | 'CURSO'; detalle: string } | null> {
  const candidatos = await prisma.horario.findMany({
    where: {
      diaSemana,
      ...(excluirId && { id: { not: excluirId } }),
      docenteMateriaCurso: {
        gestionId: dmc.gestionId,
        OR: [{ docenteId: dmc.docenteId }, { cursoId: dmc.cursoId }],
      },
    },
    include: {
      docenteMateriaCurso: {
        include: {
          docente: { select: { persona: { select: { nombre: true, apellido: true } } } },
          curso:   { select: { nivel: true, grado: true, paralelo: true } },
          materia: { select: { nombre: true } },
        },
      },
    },
  })

  for (const c of candidatos) {
    if (!seSolapan(horaInicio, horaFin, c.horaInicio, c.horaFin)) continue

    if (c.docenteMateriaCurso.docenteId === dmc.docenteId) {
      const p = c.docenteMateriaCurso.docente.persona
      return {
        tipo: 'DOCENTE',
        detalle: `El docente ${p.nombre} ${p.apellido} ya tiene "${c.docenteMateriaCurso.materia.nombre}" ese día de ${aTexto(c.horaInicio)} a ${aTexto(c.horaFin)}`,
      }
    }
    if (c.docenteMateriaCurso.cursoId === dmc.cursoId) {
      const cu = c.docenteMateriaCurso.curso
      return {
        tipo: 'CURSO',
        detalle: `El curso ${cu.grado}° ${cu.nivel} "${cu.paralelo}" ya tiene "${c.docenteMateriaCurso.materia.nombre}" ese día de ${aTexto(c.horaInicio)} a ${aTexto(c.horaFin)}`,
      }
    }
  }
  return null
}

function formatearHorario(h: any) {
  return {
    id:                    h.id,
    diaSemana:             h.diaSemana,
    horaInicio:            aTexto(h.horaInicio),
    horaFin:               aTexto(h.horaFin),
    aula:                  h.aula,
    docenteMateriaCursoId: h.docenteMateriaCursoId,
    materia:               h.docenteMateriaCurso.materia,
    curso:                 h.docenteMateriaCurso.curso,
    docente:               { id: h.docenteMateriaCurso.docente.id, ...h.docenteMateriaCurso.docente.persona },
  }
}

const INCLUDE_COMPLETO = {
  docenteMateriaCurso: {
    include: {
      materia: { select: { id: true, nombre: true } },
      curso:   { select: { id: true, nivel: true, grado: true, paralelo: true } },
      docente: { select: { id: true, persona: { select: { nombre: true, apellido: true } } } },
    },
  },
}

// ─── GET /api/horarios ─────────────────────────────────────────────────────
// ?docenteMateriaCursoId= → bloques de una asignación puntual
// ?cursoId=&gestionId=    → horario semanal completo de un curso
// ?docenteId=&gestionId=  → horario semanal completo de un docente
// Sin filtros y con rol ESTUDIANTE → resuelve su curso (inscripción activa).
// Sin filtros y con rol TUTOR → requiere estudianteId y resuelve su curso.
// Todo público para autenticados: sin validación de pertenencia.
export const getHorarios = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { cursoId, gestionId, docenteMateriaCursoId, docenteId, estudianteId } = req.query as {
    cursoId?: string; gestionId?: string; docenteMateriaCursoId?: string
    docenteId?: string; estudianteId?: string
  }

  const rolesAdmin     = req.user!.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))
  const soloEstudiante = req.user!.roles.includes('ESTUDIANTE') && !rolesAdmin
  const soloTutor      = req.user!.roles.includes('TUTOR') && !rolesAdmin

  let where: Record<string, unknown> = {}

  if (docenteMateriaCursoId) {
    const dmcId = Number(docenteMateriaCursoId)
    if (!Number.isInteger(dmcId)) {
      res.status(400).json({ error: 'docenteMateriaCursoId debe ser un número' })
      return
    }
    where = { docenteMateriaCursoId: dmcId }

  } else if (soloEstudiante) {
    const estudiante = await prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id } })
    if (!estudiante) {
      res.status(403).json({ error: 'Perfil de estudiante no encontrado' })
      return
    }
    const inscripcion = await prisma.inscripcion.findFirst({
      where: { estudianteId: estudiante.id, estadoInscripcion: 'ACTIVA', gestion: { activa: true } },
    })
    if (!inscripcion) { res.status(404).json({ error: 'No tienes una inscripción activa' }); return }
    where = { docenteMateriaCurso: { cursoId: inscripcion.cursoId, gestionId: inscripcion.gestionId } }

  } else if (soloTutor) {
    if (!estudianteId) { res.status(400).json({ error: 'estudianteId es requerido' }); return }
    const estId = Number(estudianteId)
    if (!Number.isInteger(estId)) {
      res.status(400).json({ error: 'estudianteId debe ser un número' })
      return
    }
    const inscripcion = await prisma.inscripcion.findFirst({
      where: { estudianteId: estId, estadoInscripcion: 'ACTIVA', gestion: { activa: true } },
    })
    if (!inscripcion) { res.status(404).json({ error: 'El estudiante no tiene una inscripción activa' }); return }
    where = { docenteMateriaCurso: { cursoId: inscripcion.cursoId, gestionId: inscripcion.gestionId } }

  } else if (cursoId) {
    const cId = Number(cursoId)
    const gId = gestionId ? Number(gestionId) : undefined
    if (!Number.isInteger(cId) || (gId !== undefined && !Number.isInteger(gId))) {
      res.status(400).json({ error: 'cursoId y gestionId deben ser números' })
      return
    }
    where = { docenteMateriaCurso: { cursoId: cId, ...(gId !== undefined && { gestionId: gId }) } }

  } else if (docenteId) {
    const dId = Number(docenteId)
    const gId = gestionId ? Number(gestionId) : undefined
    if (!Number.isInteger(dId) || (gId !== undefined && !Number.isInteger(gId))) {
      res.status(400).json({ error: 'docenteId y gestionId deben ser números' })
      return
    }
    where = { docenteMateriaCurso: { docenteId: dId, ...(gId !== undefined && { gestionId: gId }) } }

  } else {
    res.status(400).json({ error: 'Especifica cursoId, docenteId o docenteMateriaCursoId' })
    return
  }

  const horarios = await prisma.horario.findMany({
    where,
    include: INCLUDE_COMPLETO,
    orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
  })

  res.status(200).json(horarios.map(formatearHorario))
})

// ─── POST /api/horarios ────────────────────────────────────────────────────
// Solo Director/Secretaria (ver horario.routes.ts) — HU-12 + HU-13.
export const createHorario = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { docenteMateriaCursoId, diaSemana, horaInicio, horaFin, aula } = req.body as HorarioInput

  if (!docenteMateriaCursoId || !diaSemana || !horaInicio || !horaFin) {
    res.status(400).json({ error: 'docenteMateriaCursoId, diaSemana, horaInicio y horaFin son obligatorios' })
    return
  }
  if (!DIAS_VALIDOS.includes(diaSemana)) {
    res.status(400).json({ error: `diaSemana debe ser uno de: ${DIAS_VALIDOS.join(', ')}` })
    return
  }

  const inicio = aHora(horaInicio)
  const fin    = aHora(horaFin)
  if (fin <= inicio) {
    res.status(400).json({ error: 'horaFin debe ser posterior a horaInicio' })
    return
  }

  try {
    const dmc = await prisma.docenteMateriaCurso.findUnique({
      where:  { id: docenteMateriaCursoId },
      select: { docenteId: true, cursoId: true, gestionId: true },
    })
    if (!dmc) {
      res.status(404).json({ error: 'Asignación docente-materia-curso no encontrada' })
      return
    }

    const conflicto = await buscarConflicto(dmc, diaSemana, inicio, fin)
    if (conflicto) {
      res.status(409).json({
        error: `Conflicto de horario (${conflicto.tipo === 'DOCENTE' ? 'docente' : 'curso'}): ${conflicto.detalle}`,
      })
      return
    }

    const horario = await prisma.horario.create({
      data: { docenteMateriaCursoId, diaSemana, horaInicio: inicio, horaFin: fin, aula },
      include: INCLUDE_COMPLETO,
    })

    res.status(201).json(formatearHorario(horario))
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ error: 'Ya existe un bloque de horario idéntico para esta asignación' })
      return
    }
    throw error // cualquier otro error sigue al error.middleware
  }
})

// ─── PUT /api/horarios/:id ─────────────────────────────────────────────────
export const updateHorario = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID inválido' })
    return
  }
  const { diaSemana, horaInicio, horaFin, aula } = req.body as HorarioInput

  const existente = await prisma.horario.findUnique({
    where:   { id },
    include: { docenteMateriaCurso: { select: { docenteId: true, cursoId: true, gestionId: true } } },
  })
  if (!existente) {
    res.status(404).json({ error: 'Horario no encontrado' })
    return
  }
  if (diaSemana && !DIAS_VALIDOS.includes(diaSemana)) {
    res.status(400).json({ error: `diaSemana debe ser uno de: ${DIAS_VALIDOS.join(', ')}` })
    return
  }

  const diaFinal    = diaSemana ?? existente.diaSemana
  const inicioFinal = horaInicio ? aHora(horaInicio) : existente.horaInicio
  const finFinal    = horaFin    ? aHora(horaFin)    : existente.horaFin

  if (finFinal <= inicioFinal) {
    res.status(400).json({ error: 'horaFin debe ser posterior a horaInicio' })
    return
  }

  const conflicto = await buscarConflicto(existente.docenteMateriaCurso, diaFinal, inicioFinal, finFinal, id)
  if (conflicto) {
    res.status(409).json({
      error: `Conflicto de horario (${conflicto.tipo === 'DOCENTE' ? 'docente' : 'curso'}): ${conflicto.detalle}`,
    })
    return
  }

  try {
    const horario = await prisma.horario.update({
      where: { id },
      data: {
        diaSemana:  diaFinal,
        horaInicio: inicioFinal,
        horaFin:    finFinal,
        ...(aula !== undefined && { aula }),
      },
      include: INCLUDE_COMPLETO,
    })
    res.status(200).json(formatearHorario(horario))
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ error: 'Ya existe un bloque de horario idéntico para esta asignación' })
      return
    }
    throw error // cualquier otro error sigue al error.middleware
  }
})

// ─── DELETE /api/horarios/:id ──────────────────────────────────────────────
export const deleteHorario = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID inválido' })
    return
  }
  const existe = await prisma.horario.findUnique({ where: { id } })
  if (!existe) {
    res.status(404).json({ error: 'Horario no encontrado' })
    return
  }
  await prisma.horario.delete({ where: { id } })
  res.status(200).json({ message: 'Bloque de horario eliminado correctamente' })
})
