// src/lib/curso.helper.ts
//
// v6 quitó el campo Curso.nombre — ahora un curso se identifica por
// nivel + grado + paralelo + turno. Estas funciones arman un nombre
// legible para respuestas de API (compat con el frontend, que ya
// mostraba "curso.nombre" en varias pantallas) y resuelven la
// progresión de un curso al siguiente año (para promociones).

import type { Nivel, Turno } from '../../prisma/generated/prisma/enums.js'

export const NIVEL_TEXTO: Record<Nivel, string> = {
  PRIMARIA:   'Primaria',
  SECUNDARIA: 'Secundaria',
}

export const TURNO_TEXTO: Record<Turno, string> = {
  MANANA: 'Mañana',
  TARDE:  'Tarde',
  NOCHE:  'Noche',
}

export function nombreCurso(curso: { nivel: Nivel; grado: number; paralelo: string; turno: Turno }): string {
  return `${curso.grado}° ${NIVEL_TEXTO[curso.nivel]} "${curso.paralelo}" (${TURNO_TEXTO[curso.turno]})`
}

// Agrega `nombre` calculado sin pisar los campos originales.
export function conNombre<T extends { nivel: Nivel; grado: number; paralelo: string; turno: Turno }>(
  curso: T
): T & { nombre: string } {
  return { ...curso, nombre: nombreCurso(curso) }
}

// Primaria 1..6 → Secundaria 1..6. Devuelve null si ya es el último
// grado de Secundaria (egresado, no hay "siguiente curso").
export function siguienteNivelGrado(nivel: Nivel, grado: number): { nivel: Nivel; grado: number } | null {
  if (nivel === 'PRIMARIA') {
    return grado < 6 ? { nivel: 'PRIMARIA', grado: grado + 1 } : { nivel: 'SECUNDARIA', grado: 1 }
  }
  // SECUNDARIA
  return grado < 6 ? { nivel: 'SECUNDARIA', grado: grado + 1 } : null
}