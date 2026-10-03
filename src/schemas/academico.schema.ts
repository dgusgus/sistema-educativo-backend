// src/schemas/academico.schema.ts
// Gestión, trimestre, curso, materia e institución.

import { z } from 'zod'
import {
  booleano, decimal, entero, enumES, fecha, id, opcional, textoOpc, textoReq,
} from './common.schema.js'

// Las fechas AAAA-MM-DD se comparan bien como texto; con hora (ISO) se usa Date.
const aMs = (s: string) => Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s)

// ─── Gestión ─────────────────────────────────────────────────────────────────
const camposGestion = {
  descripcion:          textoOpc(255),
  fechaInicio:          opcional(fecha),
  fechaFin:             opcional(fecha),
  notaMinimaAprobacion: opcional(decimal(0, 100)),
}
const finPosterior = <T extends { fechaInicio?: string; fechaFin?: string }>(o: T) =>
  o.fechaInicio === undefined || o.fechaFin === undefined || aMs(o.fechaFin) > aMs(o.fechaInicio)

export const createGestionSchema = z
  .object({
    anio:      entero(2000, 2100),
    directorId: opcional(id),
    ...camposGestion,
  })
  .refine(finPosterior, { message: 'fechaFin debe ser posterior a fechaInicio', path: ['fechaFin'] })

export const updateGestionSchema = z
  .object(camposGestion)
  .refine(finPosterior, { message: 'fechaFin debe ser posterior a fechaInicio', path: ['fechaFin'] })

export const asignarDirectorSchema = z.object({ directorId: id })

// ─── Trimestre ───────────────────────────────────────────────────────────────
export const createTrimestreSchema = z
  .object({
    numero:      entero(1, 3),
    nombre:      textoReq(100),
    fechaInicio: fecha,
    fechaFin:    fecha,
    gestionId:   id,
  })
  .refine(o => aMs(o.fechaFin) > aMs(o.fechaInicio), {
    message: 'fechaFin debe ser posterior a fechaInicio',
    path: ['fechaFin'],
  })

export const updateTrimestreSchema = z
  .object({
    nombre:      opcional(textoReq(100)),
    fechaInicio: opcional(fecha),
    fechaFin:    opcional(fecha),
  })
  .refine(finPosterior, { message: 'fechaFin debe ser posterior a fechaInicio', path: ['fechaFin'] })

// ─── Curso ───────────────────────────────────────────────────────────────────
const TURNOS = ['MANANA', 'TARDE', 'NOCHE'] as const

export const createCursoSchema = z.object({
  nivel:     enumES(['PRIMARIA', 'SECUNDARIA']),
  grado:     entero(1, 12),
  paralelo:  textoReq(5),
  turno:     opcional(enumES(TURNOS)),
  capacidad: opcional(entero(1, 200)),
  gestionId: id,
})

// nivel NO se edita a propósito (rompería el historial académico).
export const updateCursoSchema = z.object({
  grado:          opcional(entero(1, 12)),
  paralelo:       opcional(textoReq(5)),
  turno:          opcional(enumES(TURNOS)),
  capacidad:      opcional(entero(1, 200)),
  activo:         booleano.optional(),
  tutorDocenteId: id.nullable().optional(),   // null = quitar el tutor del curso
})

// ─── Materia ─────────────────────────────────────────────────────────────────
export const createMateriaSchema = z.object({
  nombre:         textoReq(100),
  codigo:         textoReq(20),
  horasSemanales: opcional(entero(1, 40)),
  campoSaberId:   opcional(id),
})

export const updateMateriaSchema = z.object({
  nombre:         opcional(textoReq(100)),
  horasSemanales: opcional(entero(1, 40)),
  campoSaberId:   opcional(id),
  activo:         booleano.optional(),
})

// ─── Institución ─────────────────────────────────────────────────────────────
export const updateInstitucionSchema = z.object({
  nombre:       opcional(textoReq(150)),
  direccion:    textoOpc(255),
  telefono:     textoOpc(30),
  email:        textoOpc(150),
  rue:          textoOpc(30),
  logoUrl:      textoOpc(500),
  municipio:    textoOpc(100),
  departamento: textoOpc(100),
})