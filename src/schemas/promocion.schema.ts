// src/schemas/promocion.schema.ts
//
// Entradas del flujo de Promoción, validadas en la RUTA (middleware `validar`).
// Los números aceptan "5" o 5 (los formularios y las query strings mandan texto).
import { z } from 'zod'
import { id, opcional } from './common.schema.js'

// Qué copiar de otra gestión (todo opcional; si no se indica, se copia).
export const copiaSchema = z.object({
  origenId:      id,
  cursos:        z.boolean().optional(),
  asignaciones:  z.boolean().optional(),
  trimestres:    z.boolean().optional(),
  dimensiones:   z.boolean().optional(),
  conceptosPago: z.boolean().optional(),
})

// GET /:id/propuesta-resultados?cursoId=N
export const resultadosQuery = z.object({ cursoId: opcional(id) })

// POST /:id/resultados — solo ids: el resultado lo calcula el servidor.
export const resultadosBody = z.object({
  inscripcionIds: z.array(id).min(1, 'Selecciona al menos un estudiante').max(2000),
  cursoId:        opcional(id),
})

// GET /:id/promocion/cursos?destinoId=N
export const cursosPromocionQuery = z.object({ destinoId: opcional(id) })

// GET /:id/promocion/matricula?cursoId=N&destinoId=M
export const propuestaMatriculaQuery = z.object({ cursoId: id, destinoId: id })

// POST /:id/promocion/matricular
export const matricularBody = z.object({
  destinoId:         id,
  cursoOrigenId:     id,
  cursoPromovidosId: opcional(id),
  cursoRepitenId:    opcional(id),
  inscripcionIds:    z.array(id).min(1, 'Selecciona al menos un estudiante').max(500),
})

export type CopiaInput           = z.infer<typeof copiaSchema>
export type ResultadosQuery      = z.infer<typeof resultadosQuery>
export type ResultadosBody       = z.infer<typeof resultadosBody>
export type CursosPromocionQuery = z.infer<typeof cursosPromocionQuery>
export type PropuestaMatriculaQuery = z.infer<typeof propuestaMatriculaQuery>
export type MatricularBody       = z.infer<typeof matricularBody>
