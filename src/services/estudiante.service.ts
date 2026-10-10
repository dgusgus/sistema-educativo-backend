// src/services/estudiante.service.ts
//
// Consulta del listado de estudiantes. Es el ejemplo de referencia del patrón
//
//     Route (permisos + validación) → Controller (HTTP) → Service (reglas/consulta)
//
// Para llevarlo al resto: mover a un service todo lo que haga `prisma.*` y ponga
// condiciones de negocio, dejando en el controller solo `req → service → res`.
// Beneficio medible: el service se prueba sin Express, y cambiar de Prisma a otra capa
// de datos (o agregar caché) toca UN archivo, no 20 controllers.

import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { leerPaginacion, respuestaPaginada } from '../lib/paginacion.js'
import type { ListarEstudiantesQuery } from '../schemas/persona.schema.js'

export async function listarEstudiantes(q: ListarEstudiantesQuery) {
  const { search, cursoId, gestionId, estadoInscripcion } = q

  const filtroInscripcion =
    cursoId !== undefined || gestionId !== undefined || estadoInscripcion !== undefined
      ? { some: {
          ...(cursoId   !== undefined && { cursoId }),
          ...(gestionId !== undefined && { gestionId }),
          // ⚠️ el campo real es "estadoInscripcion". Ya validado contra la lista
          // permitida por zod: se eliminó el `as any` que dejaba pasar cualquier texto.
          ...(estadoInscripcion !== undefined && { estadoInscripcion }),
        } }
      : undefined

  const where = {
    activo: true,
    persona: search
      ? { OR: [
          { nombre:   { contains: search, mode: 'insensitive' as const } },
          { apellido: { contains: search, mode: 'insensitive' as const } },
          { ci:       { contains: search } },
        ] }
      : undefined,
    inscripciones: filtroInscripcion,
  }

  const pagina = leerPaginacion(q)

  const consulta = {
    where,
    include: {
      persona: true,
      inscripciones: {
        include: {
          curso:   { select: { id: true, nivel: true, grado: true, paralelo: true } },
          gestion: { select: { id: true, anio: true, activa: true } },
        },
        orderBy: { gestion: { anio: 'desc' as const } },
        take: 1,
      },
      tutores: {
        include: {
          tutor: { select: { id: true, persona: { select: { nombre: true, apellido: true, telefono: true } } } },
        },
      },
      usuario: { select: { id: true, username: true, activo: true } },
    },
    orderBy: [{ persona: { apellido: 'asc' as const } }, { id: 'asc' as const }],   // id desempata: paginar sin orden estable repite/omite filas
    ...(pagina && { skip: pagina.skip, take: pagina.take }),
  }

  const [estudiantes, total] = pagina
    ? await prisma.$transaction([prisma.estudiante.findMany(consulta), prisma.estudiante.count({ where })])
    : [await prisma.estudiante.findMany(consulta), 0]

  const data = estudiantes.map(e => ({
    ...aplanarPersona(e),
    tutores: e.tutores.map(t => ({ ...t, tutor: { id: t.tutor.id, ...t.tutor.persona } })),
  }))

  return pagina ? respuestaPaginada(data, total, pagina) : data
}
