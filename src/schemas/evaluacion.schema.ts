// src/schemas/evaluacion.schema.ts
// Dimensiones, actividades evaluativas, notas, calificaciones, actividades
// de clase y asistencia.

import { z } from 'zod'
import {
  booleano, decimal, entero, enumES, fecha, id, opcional, textoOpc, textoReq,
} from './common.schema.js'

// Las columnas son Decimal(5,2) (máx 999.99) y Decimal(4,3) para pesos (máx 9.999).
const PUNTAJE_MAX = 999.99
const puntaje = decimal(0, PUNTAJE_MAX, { minExclusivo: true })
// Peso como FRACCIÓN (0.45 = 45 %), no como porcentaje entero (45 desborda el campo).
const peso = decimal(0, 9.999)

// Un mismo inscripcionId no puede venir dos veces en un lote.
const sinRepetidos = (items: { inscripcionId: number }[]) =>
  new Set(items.map(i => i.inscripcionId)).size === items.length

// ─── Dimensiones de evaluación ───────────────────────────────────────────────
export const createDimensionSchema = z.object({
  gestionId:       id,
  nombre:          textoReq(100),
  puntajeMaximo:   puntaje,
  pesoEnPromedio:  opcional(peso),
  orden:           opcional(entero(0, 100)),
  esAutoevaluada:  booleano.optional(),
})

export const updateDimensionSchema = z.object({
  nombre:          opcional(textoReq(100)),
  puntajeMaximo:   opcional(puntaje),
  pesoEnPromedio:  opcional(peso),
  orden:           opcional(entero(0, 100)),
  esAutoevaluada:  booleano.optional(),
})

// ─── Actividades evaluativas y notas ─────────────────────────────────────────
export const createActividadEvaluativaSchema = z.object({
  docenteMateriaCursoId: id,
  trimestreId:           id,
  dimensionId:           id,
  nombre:                textoReq(150),
  fecha:                 opcional(fecha),
  puntajeMaximo:         puntaje,
  peso:                  opcional(peso),
  esRecuperatorio:       booleano.optional(),
})

// El tope de cada nota (≤ puntajeMaximo de la actividad) lo sigue comprobando
// el controlador, porque depende de la actividad guardada en la base de datos.
export const registrarNotasActividadSchema = z.object({
  notas: z
    .array(
      z.object({
        inscripcionId: id,
        nota:          decimal(0, PUNTAJE_MAX),
        observacion:   textoOpc(255),
      }),
      { error: (iss) => (iss.input === undefined ? 'es obligatorio' : 'debe ser una lista de notas') }
    )
    .min(1, 'debe incluir al menos una nota')
    .max(300, 'máximo 300 notas por envío')
    .refine(sinRepetidos, 'hay estudiantes repetidos en la lista'),
})

// ─── Calificación trimestral (corrección manual) ─────────────────────────────
export const updateCalificacionSchema = z.object({
  promedioTrimestral: decimal(0, 100),
  motivo:             textoReq(500),
})

// ─── Actividad de clase (tema / tarea) ───────────────────────────────────────
export const createActividadSchema = z.object({
  docenteMateriaCursoId: id,
  trimestreId:           opcional(id),
  fecha:                 opcional(fecha),
  tema:                  textoReq(200),
  descripcion:           textoOpc(2000),
  tareaAsignada:         textoOpc(2000),
})

export const updateActividadSchema = z.object({
  tema:          opcional(textoReq(200)),
  descripcion:   textoOpc(2000),
  tareaAsignada: textoOpc(2000),
})

// ─── Asistencia ──────────────────────────────────────────────────────────────
const ESTADOS_ASISTENCIA = ['PRESENTE', 'AUSENTE', 'RETRASO', 'JUSTIFICADO'] as const

export const registrarAsistenciaSchema = z.object({
  docenteMateriaCursoId: id,
  trimestreId:           id,
  fecha,
  registros: z
    .array(
      z.object({
        inscripcionId: id,
        estado:        enumES(ESTADOS_ASISTENCIA),
        justificacion: textoOpc(500),
      }),
      { error: (iss) => (iss.input === undefined ? 'es obligatorio' : 'debe ser una lista de registros') }
    )
    .min(1, 'debe incluir al menos un registro')
    .max(300, 'máximo 300 registros por envío')
    .refine(sinRepetidos, 'hay estudiantes repetidos en la lista'),
})

export const actualizarAsistenciaSchema = z.object({
  estado:        enumES(ESTADOS_ASISTENCIA),
  justificacion: textoOpc(500),
})