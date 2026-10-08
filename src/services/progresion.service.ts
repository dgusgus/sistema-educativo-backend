// src/services/progresion.service.ts
//
// A qué curso le corresponde inscribirse a un estudiante, según su historial.
//
// REGLA (se aplica en el servidor, así que cubre la inscripción individual y la
// matrícula masiva por igual):
//   · Sin inscripciones anteriores        → libre (nuevo ingreso / procedencia).
//   · Última inscripción PROMOVIDO        → SOLO el grado siguiente
//                                           (6° Primaria → 1° Secundaria).
//   · Última inscripción REPROBADO        → SOLO el mismo grado (repite).
//   · PROMOVIDO en 6° Secundaria          → egresó: no corresponde inscribirlo.
//   · Última inscripción sin resultado    → primero hay que registrar su resultado
//                                           (si fue retiro o transferencia no hay
//                                           resultado y se deja libre).
//
// No hace falta ninguna tabla nueva: el historial ES la cadena de inscripciones
// del estudiante (una por gestión: curso, estado y resultado).

import { prisma } from '../lib/prisma.js'
import type { Prisma } from '../../prisma/generated/prisma/client.js'
import { ErrorDeUsuario } from '../lib/errores.js'
import { NIVEL_TEXTO, siguienteNivelGrado } from '../lib/curso.helper.js'
import { promedioFinalDe, redondear2 } from '../lib/promedio-final.helper.js'

type Db = Prisma.TransactionClient
type Nivel = 'PRIMARIA' | 'SECUNDARIA'

const etiquetaGrado = (c: { nivel: Nivel; grado: number }) => `${c.grado}° ${NIVEL_TEXTO[c.nivel]}`
const etiquetaCurso = (c: { nivel: Nivel; grado: number; paralelo: string }) => `${etiquetaGrado(c)} "${c.paralelo}"`

// ─── A qué curso le corresponde ──────────────────────────────────────────────
export type CursoEsperado =
  | { tipo: 'LIBRE';     motivo: string }
  | { tipo: 'FIJO';      nivel: Nivel; grado: number; etiqueta: string; corresponde: string; motivo: string }
  | { tipo: 'EGRESADO';  motivo: string }
  | { tipo: 'PENDIENTE'; motivo: string }

// Mira la última inscripción ANTERIOR al año indicado.
export async function cursoEsperadoEstudiante(
  estudianteId: number,
  anioDestino: number,
  db: Db = prisma,
): Promise<CursoEsperado> {
  const previa = await db.inscripcion.findFirst({
    where:   { estudianteId, gestion: { anio: { lt: anioDestino } } },
    orderBy: { gestion: { anio: 'desc' } },
    include: {
      curso:   { select: { nivel: true, grado: true } },
      gestion: { select: { anio: true } },
    },
  })

  if (!previa) return { tipo: 'LIBRE', motivo: 'Nuevo ingreso: puede inscribirse en cualquier curso' }

  const anterior = `${etiquetaGrado(previa.curso)} en ${previa.gestion.anio}`

  if (previa.estadoInscripcion === 'RETIRADA' || previa.estadoInscripcion === 'TRANSFERIDA') {
    return { tipo: 'LIBRE', motivo: `Estuvo ${previa.estadoInscripcion === 'RETIRADA' ? 'retirado' : 'transferido'} (${anterior}): sin resultado que condicione el curso` }
  }

  if (previa.resultado === 'PROMOVIDO') {
    const siguiente = siguienteNivelGrado(previa.curso.nivel, previa.curso.grado)
    if (!siguiente) return { tipo: 'EGRESADO', motivo: `Egresó (promovido de ${anterior})` }
    return {
      tipo: 'FIJO', nivel: siguiente.nivel, grado: siguiente.grado,
      etiqueta: etiquetaGrado(siguiente), corresponde: etiquetaGrado(siguiente),
      motivo: `Promovido de ${anterior}`,
    }
  }

  if (previa.resultado === 'REPROBADO') {
    return {
      tipo: 'FIJO', nivel: previa.curso.nivel, grado: previa.curso.grado,
      etiqueta: etiquetaGrado(previa.curso), corresponde: `repetir ${etiquetaGrado(previa.curso)}`,
      motivo: `Reprobó ${anterior}`,
    }
  }

  return { tipo: 'PENDIENTE', motivo: `Su inscripción de ${previa.gestion.anio} (${etiquetaGrado(previa.curso)}) no tiene resultado final registrado` }
}

// Lanza 409 si el curso elegido no es el que le corresponde.
export async function validarProgresionInscripcion(
  estudianteId: number,
  curso: { nivel: Nivel; grado: number },
  anioDestino: number,
  db: Db = prisma,
): Promise<void> {
  const esperado = await cursoEsperadoEstudiante(estudianteId, anioDestino, db)

  if (esperado.tipo === 'LIBRE') return
  if (esperado.tipo === 'EGRESADO')  throw new ErrorDeUsuario(`${esperado.motivo}: no corresponde inscribirlo de nuevo`, 409)
  if (esperado.tipo === 'PENDIENTE') throw new ErrorDeUsuario(`${esperado.motivo}. Registrar primero su resultado en Promoción`, 409)

  if (curso.nivel !== esperado.nivel || curso.grado !== esperado.grado) {
    throw new ErrorDeUsuario(
      `${esperado.motivo}: le corresponde ${esperado.corresponde} y no puede inscribirse en ${etiquetaGrado(curso)}`,
      409,
    )
  }
}

// ─── Historial académico ─────────────────────────────────────────────────────
export interface EntradaHistorial {
  inscripcionId:    number
  gestionId:        number
  anio:             number
  curso:            string
  estado:           'ACTIVA' | 'CONCLUIDA' | 'RETIRADA' | 'TRANSFERIDA'
  resultado:        'PENDIENTE' | 'PROMOVIDO' | 'REPROBADO'
  fechaInscripcion: Date
  fechaRetiro:      Date | null
  procedencia:      string | null
  promedioGeneral:  number | null
  /** De dónde viene: curso del año anterior, procedencia o "Nuevo ingreso". */
  desde:            string
  /** A dónde va: curso del año siguiente o su situación (egresado, repite, en curso...). */
  hacia:            string
}

export interface HistorialAcademico {
  estudiante: { id: number; nombre: string; ci: string | null }
  /** Qué le corresponde para su próxima inscripción (mismo cálculo que valida el servidor). */
  proximo:    CursoEsperado
  historial:  EntradaHistorial[]
}

// anioDestino = año de la gestión donde se quiere inscribir; si no se indica, el siguiente a la última inscripción.
export async function obtenerHistorialEstudiante(
  estudianteId: number,
  anioDestino?: number,
  db: Db = prisma,
): Promise<HistorialAcademico> {
  const estudiante = await db.estudiante.findUnique({
    where:  { id: estudianteId },
    select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } },
  })
  if (!estudiante) throw new ErrorDeUsuario('Estudiante no encontrado', 404)

  const inscripciones = await db.inscripcion.findMany({
    where:   { estudianteId },
    orderBy: { gestion: { anio: 'asc' } },
    include: {
      gestion: { select: { id: true, anio: true } },
      curso:   { select: { nivel: true, grado: true, paralelo: true } },
    },
  })

  // Promedio general de cada año, calculado desde las notas de cada trimestre
  // (la fuente real), con la misma fórmula que el promedio final de cada materia.
  const ids        = inscripciones.map(i => i.id)
  const gestionIds = [...new Set(inscripciones.map(i => i.gestionId))]
  const [trimestres, calificaciones] = await Promise.all([
    db.trimestre.findMany({ where: { gestionId: { in: gestionIds } }, select: { gestionId: true } }),
    db.calificacion.findMany({
      where:  { inscripcionId: { in: ids }, promedioTrimestral: { not: null } },
      select: { inscripcionId: true, docenteMateriaCursoId: true, trimestreId: true, promedioTrimestral: true },
    }),
  ])
  const totalTrimestres = new Map<number, number>()
  for (const t of trimestres) totalTrimestres.set(t.gestionId, (totalTrimestres.get(t.gestionId) ?? 0) + 1)

  const notas = new Map<number, Map<number, Map<number, number>>>() // inscripción → materia → trimestre → nota
  for (const c of calificaciones) {
    const porMateria   = notas.get(c.inscripcionId) ?? new Map<number, Map<number, number>>()
    const porTrimestre = porMateria.get(c.docenteMateriaCursoId) ?? new Map<number, number>()
    porTrimestre.set(c.trimestreId, Number(c.promedioTrimestral))
    porMateria.set(c.docenteMateriaCursoId, porTrimestre)
    notas.set(c.inscripcionId, porMateria)
  }

  const promedioDe = (inscripcionId: number, gestionId: number): number | null => {
    const porMateria = notas.get(inscripcionId)
    if (!porMateria || porMateria.size === 0) return null
    const finales: number[] = []
    for (const trimestres of porMateria.values()) {
      const f = promedioFinalDe([...trimestres.values()], totalTrimestres.get(gestionId) ?? 0)
      if (f === null) return null // año incompleto: no se muestra un promedio engañoso
      finales.push(f)
    }
    return redondear2(finales.reduce((a, b) => a + b, 0) / finales.length)
  }

  const historial: EntradaHistorial[] = inscripciones.map((insc, i) => {
    const previa    = inscripciones[i - 1]
    const siguiente = inscripciones[i + 1]

    const desde = previa
      ? `${etiquetaCurso(previa.curso)} (${previa.gestion.anio})`
      : insc.procedencia ? `Procedencia: ${insc.procedencia}` : 'Nuevo ingreso'

    let hacia: string
    if (siguiente) {
      hacia = `${etiquetaCurso(siguiente.curso)} (${siguiente.gestion.anio})`
    } else if (insc.estadoInscripcion === 'RETIRADA')    hacia = 'Retirado'
    else if (insc.estadoInscripcion === 'TRANSFERIDA')   hacia = 'Transferido'
    else if (insc.resultado === 'PROMOVIDO') {
      const sig = siguienteNivelGrado(insc.curso.nivel, insc.curso.grado)
      hacia = sig ? `Le corresponde ${etiquetaGrado(sig)}` : 'Egresado'
    } else if (insc.resultado === 'REPROBADO') hacia = `Repite ${etiquetaGrado(insc.curso)}`
    else hacia = 'En curso'

    return {
      inscripcionId:    insc.id,
      gestionId:        insc.gestionId,
      anio:             insc.gestion.anio,
      curso:            etiquetaCurso(insc.curso),
      estado:           insc.estadoInscripcion,
      resultado:        insc.resultado,
      fechaInscripcion: insc.fechaInscripcion,
      fechaRetiro:      insc.fechaRetiro,
      procedencia:      insc.procedencia,
      promedioGeneral:  promedioDe(insc.id, insc.gestionId),
      desde,
      hacia,
    }
  })

  const ultimo = inscripciones[inscripciones.length - 1]
  const anioProximo = anioDestino ?? (ultimo ? ultimo.gestion.anio + 1 : undefined)
  const proximo: CursoEsperado = anioProximo !== undefined
    ? await cursoEsperadoEstudiante(estudianteId, anioProximo, db)
    : { tipo: 'LIBRE', motivo: 'Nuevo ingreso: puede inscribirse en cualquier curso' }

  return {
    estudiante: {
      id: estudiante.id,
      nombre: `${estudiante.persona.apellido} ${estudiante.persona.nombre}`,
      ci: estudiante.persona.ci,
    },
    proximo,
    historial,
  }
}