// src/services/copiar-estructura.service.ts
//
// Copia la ESTRUCTURA de una gestión a otra para no recrearla a mano cada año.
//
// ¿Por qué se copia en vez de compartir? Curso, DocenteMateriaCurso, Trimestre,
// DimensionEvaluacion y ConceptoPago pertenecen a UNA gestión a propósito: las
// notas, la asistencia y los horarios cuelgan de las asignaciones de ese año, y
// si fueran globales se perdería el historial. Copiar deja cada año intacto.
//
// Qué se copia (cada parte es opcional):
//   · cursos         → nivel, grado, paralelo, turno, capacidad y docente guía
//                      (solo los activos). SIN estudiantes ni inscripciones.
//   · asignaciones   → docente + materia + curso (se omiten docentes o materias
//                      inactivos y se avisa cuáles).
//   · trimestres     → mismos números y nombres, fechas desplazadas la
//                      diferencia de años; siempre abiertos.
//   · dimensiones    → nombre, puntaje máximo, peso, orden.
//   · conceptosPago  → solo los activos, con fecha de vencimiento desplazada.
//
// NO se copian horarios (dependen de cada año), ni notas, ni asistencia, ni pagos.
// Es ADITIVO e idempotente: lo que ya existe en el destino se respeta y se
// cuenta como "yaExistian"; nunca se borra ni se pisa nada.

import { prisma } from '../lib/prisma.js'
import type { Prisma } from '../../prisma/generated/prisma/client.js'
import { ErrorDeUsuario } from '../lib/errores.js'

type Db = Prisma.TransactionClient

export interface OpcionesCopia {
  cursos:        boolean
  asignaciones:  boolean
  trimestres:    boolean
  dimensiones:   boolean
  conceptosPago: boolean
}

export const COPIA_COMPLETA: OpcionesCopia = {
  cursos: true, asignaciones: true, trimestres: true, dimensiones: true, conceptosPago: true,
}

export interface ContadorCopia {
  copiados:   number
  yaExistian: number
  omitidos:   number
}

export interface ResultadoCopia {
  origen:        { id: number; anio: number }
  destino:       { id: number; anio: number }
  cursos:        ContadorCopia
  asignaciones:  ContadorCopia
  trimestres:    ContadorCopia
  dimensiones:   ContadorCopia
  conceptosPago: ContadorCopia
  avisos:        string[]
}

const vacio = (): ContadorCopia => ({ copiados: 0, yaExistian: 0, omitidos: 0 })

// Las columnas @db.Date llegan como Date a medianoche UTC: se desplaza en UTC
// para que el día no se corra por la zona horaria.
function desplazarAnios(fecha: Date, anios: number): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear() + anios, fecha.getUTCMonth(), fecha.getUTCDate()))
}

const claveCurso = (c: { nivel: string; grado: number; paralelo: string; turno: string }) =>
  `${c.nivel}|${c.grado}|${c.paralelo}|${c.turno}`

export async function copiarEstructura(
  origenId: number,
  destinoId: number,
  opciones: Partial<OpcionesCopia> = COPIA_COMPLETA,
  db: Db = prisma,
): Promise<ResultadoCopia> {
  const op: OpcionesCopia = {
    cursos:        opciones.cursos        ?? true,
    asignaciones:  opciones.asignaciones  ?? true,
    trimestres:    opciones.trimestres    ?? true,
    dimensiones:   opciones.dimensiones   ?? true,
    conceptosPago: opciones.conceptosPago ?? true,
  }
  if (!Object.values(op).some(Boolean)) throw new ErrorDeUsuario('Elegí al menos una parte de la estructura para copiar')
  if (origenId === destinoId)            throw new ErrorDeUsuario('La gestión de origen y la de destino no pueden ser la misma')

  const [origen, destino] = await Promise.all([
    db.gestion.findUnique({ where: { id: origenId },  select: { id: true, anio: true } }),
    db.gestion.findUnique({ where: { id: destinoId }, select: { id: true, anio: true } }),
  ])
  if (!origen)  throw new ErrorDeUsuario('Gestión de origen no encontrada', 404)
  if (!destino) throw new ErrorDeUsuario('Gestión de destino no encontrada', 404)
  // Evita copiar "hacia atrás" por error (de 2027 a 2026).
  if (destino.anio <= origen.anio) {
    throw new ErrorDeUsuario(`La gestión de destino (${destino.anio}) debe ser posterior a la de origen (${origen.anio})`)
  }

  const difAnios = destino.anio - origen.anio
  const r: ResultadoCopia = {
    origen, destino,
    cursos: vacio(), asignaciones: vacio(), trimestres: vacio(), dimensiones: vacio(), conceptosPago: vacio(),
    avisos: [],
  }

  // ── Cursos ─────────────────────────────────────────────────────────────────
  if (op.cursos) {
    const [delOrigen, delDestino, docentesActivos] = await Promise.all([
      db.curso.findMany({ where: { gestionId: origen.id, activo: true }, orderBy: [{ nivel: 'asc' }, { grado: 'asc' }, { paralelo: 'asc' }] }),
      db.curso.findMany({ where: { gestionId: destino.id }, select: { nivel: true, grado: true, paralelo: true, turno: true } }),
      db.docente.findMany({ where: { activo: true }, select: { id: true } }),
    ])
    const existentes = new Set(delDestino.map(claveCurso))
    const activos    = new Set(docentesActivos.map(d => d.id))
    let guiaPerdido  = 0

    for (const c of delOrigen) {
      if (existentes.has(claveCurso(c))) { r.cursos.yaExistian++; continue }
      const guiaVigente = c.tutorDocenteId !== null && activos.has(c.tutorDocenteId)
      if (c.tutorDocenteId !== null && !guiaVigente) guiaPerdido++
      await db.curso.create({
        data: {
          nivel: c.nivel, grado: c.grado, paralelo: c.paralelo, turno: c.turno,
          capacidad: c.capacidad, gestionId: destino.id,
          tutorDocenteId: guiaVigente ? c.tutorDocenteId : null,
        },
      })
      r.cursos.copiados++
    }
    if (guiaPerdido) r.avisos.push(`${guiaPerdido} curso(s) quedaron sin docente guía porque el de ${origen.anio} ya no está activo`)
  }

  // ── Asignaciones (docente + materia + curso) ────────────────────────────────
  if (op.asignaciones) {
    const cursosDestino = await db.curso.findMany({
      where: { gestionId: destino.id },
      select: { id: true, nivel: true, grado: true, paralelo: true, turno: true },
    })
    const idPorClave = new Map(cursosDestino.map(c => [claveCurso(c), c.id]))

    const delOrigen = await db.docenteMateriaCurso.findMany({
      where: { gestionId: origen.id },
      include: {
        curso:   { select: { nivel: true, grado: true, paralelo: true, turno: true, activo: true } },
        docente: { select: { activo: true, persona: { select: { nombre: true, apellido: true } } } },
        materia: { select: { activo: true, nombre: true } },
      },
    })

    const aCrear: { docenteId: number; materiaId: number; cursoId: number; gestionId: number }[] = []
    const docentesOmitidos = new Set<string>()
    let sinCurso = 0

    for (const a of delOrigen) {
      if (!a.curso.activo || !a.materia.activo) { r.asignaciones.omitidos++; continue }
      if (!a.docente.activo) {
        r.asignaciones.omitidos++
        docentesOmitidos.add(`${a.docente.persona.nombre} ${a.docente.persona.apellido}`)
        continue
      }
      const cursoId = idPorClave.get(claveCurso(a.curso))
      if (cursoId === undefined) { r.asignaciones.omitidos++; sinCurso++; continue }
      aCrear.push({ docenteId: a.docenteId, materiaId: a.materiaId, cursoId, gestionId: destino.id })
    }

    // skipDuplicates respeta la restricción única (docente, materia, curso, gestión).
    const creadas = aCrear.length
      ? (await db.docenteMateriaCurso.createMany({ data: aCrear, skipDuplicates: true })).count
      : 0
    r.asignaciones.copiados   = creadas
    r.asignaciones.yaExistian = aCrear.length - creadas

    if (docentesOmitidos.size) r.avisos.push(`Asignaciones omitidas por docente inactivo: ${[...docentesOmitidos].join(', ')}`)
    if (sinCurso)              r.avisos.push(`${sinCurso} asignación(es) omitidas porque su curso no existe en ${destino.anio} (copiá también los cursos)`)
  }

  // ── Trimestres ──────────────────────────────────────────────────────────────
  if (op.trimestres) {
    const [delOrigen, delDestino] = await Promise.all([
      db.trimestre.findMany({ where: { gestionId: origen.id }, orderBy: { numero: 'asc' } }),
      db.trimestre.findMany({ where: { gestionId: destino.id }, select: { numero: true } }),
    ])
    const existentes = new Set(delDestino.map(t => t.numero))
    for (const t of delOrigen) {
      if (existentes.has(t.numero)) { r.trimestres.yaExistian++; continue }
      await db.trimestre.create({
        data: {
          numero: t.numero, nombre: t.nombre, gestionId: destino.id,
          fechaInicio: desplazarAnios(t.fechaInicio, difAnios),
          fechaFin:    desplazarAnios(t.fechaFin, difAnios),
        },
      })
      r.trimestres.copiados++
    }
    if (r.trimestres.copiados) r.avisos.push(`Revisá las fechas de los trimestres: se copiaron desplazadas ${difAnios} año(s)`)
  }

  // ── Dimensiones de evaluación ───────────────────────────────────────────────
  if (op.dimensiones) {
    const delOrigen = await db.dimensionEvaluacion.findMany({ where: { gestionId: origen.id }, orderBy: { orden: 'asc' } })
    if (delOrigen.length) {
      const { count } = await db.dimensionEvaluacion.createMany({
        data: delOrigen.map(d => ({
          gestionId: destino.id, nombre: d.nombre, puntajeMaximo: d.puntajeMaximo,
          pesoEnPromedio: d.pesoEnPromedio, orden: d.orden, esAutoevaluada: d.esAutoevaluada,
        })),
        skipDuplicates: true, // única (gestión, nombre)
      })
      r.dimensiones.copiados   = count
      r.dimensiones.yaExistian = delOrigen.length - count
    }
  }

  // ── Conceptos de pago ───────────────────────────────────────────────────────
  if (op.conceptosPago) {
    const [delOrigen, delDestino] = await Promise.all([
      db.conceptoPago.findMany({ where: { gestionId: origen.id, activo: true } }),
      db.conceptoPago.findMany({ where: { gestionId: destino.id }, select: { nombre: true } }),
    ])
    // ConceptoPago no tiene restricción única: se evita duplicar por nombre.
    const existentes = new Set(delDestino.map(c => c.nombre.trim().toLowerCase()))
    for (const c of delOrigen) {
      if (existentes.has(c.nombre.trim().toLowerCase())) { r.conceptosPago.yaExistian++; continue }
      await db.conceptoPago.create({
        data: {
          gestionId: destino.id, nombre: c.nombre, descripcion: c.descripcion, monto: c.monto,
          obligatorio: c.obligatorio, aplicarMora: c.aplicarMora, porcentajeMora: c.porcentajeMora,
          fechaVencimiento: c.fechaVencimiento ? desplazarAnios(c.fechaVencimiento, difAnios) : null,
        },
      })
      r.conceptosPago.copiados++
    }
    if (r.conceptosPago.copiados) r.avisos.push('Revisá los montos y las fechas de vencimiento de los conceptos de pago copiados')
  }

  return r
}