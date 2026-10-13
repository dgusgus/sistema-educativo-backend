// src/lib/paginacion.ts
//
// Paginación OPT-IN: si la petición trae ?pagina=, la respuesta es
//   { data: [...], meta: { pagina, limite, total, totalPaginas } }
// y si no la trae, el endpoint responde el arreglo completo como siempre.
//
// ¿Para qué? Casi todos los listados hacían findMany() sin límite: con ~330 estudiantes
// hoy no se nota, pero cada gestión se suman más años de historial y el listado crece sin
// techo (más memoria en Node, más JSON por la red, tabla más lenta en el navegador).
// Que sea opt-in permite activarlo endpoint por endpoint SIN romper el frontend actual.

import { z } from 'zod'
import { entero, opcional } from '../schemas/common.schema.js'

export const paginacionSchema = {
  pagina: opcional(entero(1, 100_000)),
  limite: opcional(entero(1, 200)),
}

export interface ParametrosPagina { pagina: number; limite: number; skip: number; take: number }

export function leerPaginacion(q: { pagina?: number | undefined; limite?: number | undefined }): ParametrosPagina | null {
  if (q.pagina === undefined) return null
  const limite = q.limite ?? 25
  return { pagina: q.pagina, limite, skip: (q.pagina - 1) * limite, take: limite }
}

export function respuestaPaginada<T>(data: T[], total: number, p: ParametrosPagina) {
  return { data, meta: { pagina: p.pagina, limite: p.limite, total, totalPaginas: Math.max(1, Math.ceil(total / p.limite)) } }
}

// Helper de tipos para los esquemas de query
export type PaginacionQuery = z.infer<z.ZodObject<typeof paginacionSchema>>
