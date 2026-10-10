// src/services/asistencia-resumen.service.ts
//
// ÚNICO escritor de ResumenAsistencia + detección de estudiantes en riesgo (< 80 %).
//
// ── Qué cambió y por qué ────────────────────────────────────────────────────
// Antes, por CADA estudiante del curso se ejecutaban 2 consultas que traían TODAS
// sus filas de asistencia a memoria (una para el resumen, otra —con include de
// persona— para las alertas) y 1 upsert, todo en serie: con 40 estudiantes eran
// ~120 consultas por cada vez que el docente guardaba la asistencia del día, y el
// volumen de filas crece cada clase durante todo el año.
//
// Ahora: UNA consulta con GROUP BY (la base de datos cuenta; a Node llegan ≤ 4 filas por
// estudiante, sin importar cuántas clases hubo), los upserts en UNA transacción y una
// sola consulta para los nombres de quienes están en riesgo.

import { prisma } from '../lib/prisma.js'

export const UMBRAL_ALERTA_ASISTENCIA = 80

type EstadoAsistencia = 'PRESENTE' | 'AUSENTE' | 'RETRASO' | 'JUSTIFICADO'

export interface ConteoAsistencia {
  presente: number; ausente: number; retraso: number; justificado: number
}

export interface ResumenCalculado extends ConteoAsistencia {
  inscripcionId: number
  totalClases:   number
  porcentaje:    number
}

// Pura. RETRASO no cuenta como presente para el % — es una falta parcial.
export function calcularResumen(inscripcionId: number, c: ConteoAsistencia): ResumenCalculado | null {
  const totalClases = c.presente + c.ausente + c.retraso + c.justificado
  if (totalClases === 0) return null
  return {
    inscripcionId, totalClases, ...c,
    porcentaje: ((c.presente + c.justificado) / totalClases) * 100,
  }
}

export async function actualizarResumenAsistencia(
  docenteMateriaCursoId: number,
  trimestreId: number,
  inscripcionIds: number[],
): Promise<ResumenCalculado[]> {
  const ids = [...new Set(inscripcionIds)]
  if (ids.length === 0) return []

  const grupos = await prisma.asistencia.groupBy({
    by:    ['inscripcionId', 'estado'],
    where: { docenteMateriaCursoId, trimestreId, inscripcionId: { in: ids } },
    _count: { _all: true },
  })

  const conteos = new Map<number, ConteoAsistencia>()
  for (const g of grupos) {
    const c = conteos.get(g.inscripcionId) ?? { presente: 0, ausente: 0, retraso: 0, justificado: 0 }
    const n = g._count._all
    switch (g.estado as EstadoAsistencia) {
      case 'PRESENTE':    c.presente    += n; break
      case 'AUSENTE':     c.ausente     += n; break
      case 'RETRASO':     c.retraso     += n; break
      case 'JUSTIFICADO': c.justificado += n; break
    }
    conteos.set(g.inscripcionId, c)
  }

  const resumenes: ResumenCalculado[] = []
  for (const [inscripcionId, c] of conteos) {
    const r = calcularResumen(inscripcionId, c)
    if (r) resumenes.push(r)
  }

  await prisma.$transaction(resumenes.map(r => {
    const datos = {
      totalClases: r.totalClases, totalPresente: r.presente, totalAusente: r.ausente,
      totalRetraso: r.retraso, totalJustificado: r.justificado, porcentaje: r.porcentaje,
    }
    return prisma.resumenAsistencia.upsert({
      where:  { inscripcionId_docenteMateriaCursoId_trimestreId: { inscripcionId: r.inscripcionId, docenteMateriaCursoId, trimestreId } },
      update: datos,
      create: { inscripcionId: r.inscripcionId, docenteMateriaCursoId, trimestreId, ...datos },
    })
  }))

  return resumenes
}

// Estudiantes por debajo del umbral, con nombre (una sola consulta para los nombres).
export async function construirAlertasAsistencia(resumenes: ResumenCalculado[]) {
  const enRiesgo = resumenes.filter(r => r.porcentaje < UMBRAL_ALERTA_ASISTENCIA)
  if (enRiesgo.length === 0) return []

  const inscripciones = await prisma.inscripcion.findMany({
    where:  { id: { in: enRiesgo.map(r => r.inscripcionId) } },
    select: { id: true, estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } },
  })
  const nombres = new Map(inscripciones.map(i => [i.id, `${i.estudiante.persona.nombre} ${i.estudiante.persona.apellido}`]))

  return enRiesgo.map(r => ({
    inscripcionId: r.inscripcionId,
    estudiante:    nombres.get(r.inscripcionId) ?? '',
    porcentaje:    Math.round(r.porcentaje * 100) / 100,
  }))
}
