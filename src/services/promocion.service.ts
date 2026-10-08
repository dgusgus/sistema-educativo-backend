// src/services/promocion.service.ts
//
// Promoción y matrícula POR CURSO.
//
// La unidad de trabajo es un curso de la gestión de origen (p. ej. 3° "A"):
//   Paso 1 · Resultados   → resultado-final.service.ts, filtrado por cursoId.
//   Paso 2 · Matrícula    → este archivo: los PROMOVIDOS del curso van a UN curso
//                           del grado siguiente y los REPROBADOS a UN curso del
//                           mismo grado, ambos de la gestión de destino.
//
// Reglas que aplica el SERVIDOR (el navegador solo manda ids y cursos elegidos):
//   · Solo estudiantes del curso de origen con resultado PROMOVIDO o REPROBADO.
//   · PROMOVIDO de 6° Secundaria egresa: no se matricula.
//   · El curso elegido para promovidos debe ser del grado siguiente y el de
//     repetidores del mismo grado, y ambos pertenecer a la gestión de destino.
//   · Nadie se matricula dos veces en la misma gestión.
//   · Se revalida la progresión según el historial (progresion.service.ts).
//   · Todo en una transacción; los estudiantes con problema se reportan uno por
//     uno y NO frenan al resto.
//
// La capacidad del curso se informa (inscritos / capacidad) pero no bloquea:
// hoy tampoco bloquea la inscripción individual.

import { prisma } from '../lib/prisma.js'
import type { Prisma } from '../../prisma/generated/prisma/client.js'
import type { Nivel, Turno } from '../../prisma/generated/prisma/enums.js'
import { ErrorDeUsuario } from '../lib/errores.js'
import { nombreCurso, siguienteNivelGrado, NIVEL_TEXTO } from '../lib/curso.helper.js'
import { validarProgresionInscripcion } from './progresion.service.js'

type Db = Prisma.TransactionClient

type CursoBase = { id: number; nivel: Nivel; grado: number; paralelo: string; turno: Turno }

// Inscripciones que cuentan para promocionar: las activas y las ya concluidas
// (al cerrar la gestión pasan de ACTIVA a CONCLUIDA). Retirados y transferidos no.
const ESTADOS_VIGENTES = ['ACTIVA', 'CONCLUIDA'] as const

export type GrupoEstudiante = 'PROMOVIDO' | 'REPITE' | 'EGRESA' | 'SIN_RESULTADO' | 'NO_APLICA'

function grupoDe(
  insc: { estadoInscripcion: string; resultado: string },
  curso: { nivel: Nivel; grado: number },
): GrupoEstudiante {
  if (insc.estadoInscripcion === 'RETIRADA' || insc.estadoInscripcion === 'TRANSFERIDA') return 'NO_APLICA'
  if (insc.resultado === 'PENDIENTE') return 'SIN_RESULTADO'
  if (insc.resultado === 'REPROBADO') return 'REPITE'
  return siguienteNivelGrado(curso.nivel, curso.grado) ? 'PROMOVIDO' : 'EGRESA'
}

const etiquetaGrado = (c: { nivel: Nivel; grado: number }) => `${c.grado}° ${NIVEL_TEXTO[c.nivel]}`

async function gestionOError(id: number, db: Db, rol: 'origen' | 'destino') {
  const g = await db.gestion.findUnique({ where: { id }, select: { id: true, anio: true } })
  if (!g) throw new ErrorDeUsuario(`Gestión de ${rol} no encontrada`, 404)
  return g
}

function validarOrden(origen: { anio: number }, destino: { anio: number }) {
  if (destino.anio <= origen.anio) {
    throw new ErrorDeUsuario(`La gestión de destino (${destino.anio}) debe ser posterior a la de origen (${origen.anio})`)
  }
}

// ─── Tablero: un renglón por curso de la gestión de origen ───────────────────
export interface CursoPromocion {
  cursoId:        number
  curso:          string
  nivel:          Nivel
  grado:          number
  paralelo:       string
  turno:          Turno
  estudiantes:    number
  sinResultado:   number
  promovidos:     number
  repiten:        number
  egresan:        number
  matriculados:   number
  porMatricular:  number
  estado:         'RESULTADOS_PENDIENTES' | 'LISTO_MATRICULAR' | 'COMPLETO'
}

export async function resumenCursosPromocion(origenId: number, destinoId?: number, db: Db = prisma) {
  const origen  = await gestionOError(origenId, db, 'origen')
  const destino = destinoId !== undefined ? await gestionOError(destinoId, db, 'destino') : null
  if (destino) validarOrden(origen, destino)

  const inscripciones = await db.inscripcion.findMany({
    where:  { gestionId: origen.id, estadoInscripcion: { in: [...ESTADOS_VIGENTES] } },
    select: {
      estudianteId: true, resultado: true, estadoInscripcion: true,
      curso: { select: { id: true, nivel: true, grado: true, paralelo: true, turno: true } },
    },
  })

  const yaMatriculados = new Set<number>()
  if (destino) {
    const delDestino = await db.inscripcion.findMany({ where: { gestionId: destino.id }, select: { estudianteId: true } })
    delDestino.forEach(i => yaMatriculados.add(i.estudianteId))
  }

  const porCurso = new Map<number, CursoPromocion>()
  for (const insc of inscripciones) {
    const c = insc.curso
    let fila = porCurso.get(c.id)
    if (!fila) {
      fila = {
        cursoId: c.id, curso: nombreCurso(c), nivel: c.nivel, grado: c.grado, paralelo: c.paralelo, turno: c.turno,
        estudiantes: 0, sinResultado: 0, promovidos: 0, repiten: 0, egresan: 0, matriculados: 0, porMatricular: 0,
        estado: 'COMPLETO',
      }
      porCurso.set(c.id, fila)
    }
    fila.estudiantes++
    const grupo = grupoDe(insc, c)
    if (grupo === 'SIN_RESULTADO') fila.sinResultado++
    else if (grupo === 'EGRESA')   fila.egresan++
    else if (grupo === 'PROMOVIDO' || grupo === 'REPITE') {
      if (grupo === 'PROMOVIDO') fila.promovidos++; else fila.repiten++
      if (yaMatriculados.has(insc.estudianteId)) fila.matriculados++; else fila.porMatricular++
    }
  }

  const cursos = [...porCurso.values()].map(f => ({
    ...f,
    estado: (f.sinResultado > 0 ? 'RESULTADOS_PENDIENTES' : f.porMatricular > 0 ? 'LISTO_MATRICULAR' : 'COMPLETO') as CursoPromocion['estado'],
  }))
  cursos.sort((a, b) =>
    a.nivel.localeCompare(b.nivel) || a.grado - b.grado || a.paralelo.localeCompare(b.paralelo) || a.turno.localeCompare(b.turno))

  return { origen, destino, cursos }
}

// ─── Propuesta de matrícula de UN curso ──────────────────────────────────────
export interface CursoDestino {
  id:        number
  nombre:    string
  paralelo:  string
  turno:     Turno
  capacidad: number | null
  inscritos: number
}

export interface EstudiantePropuesta {
  inscripcionId: number
  estudianteId:  number
  estudiante:    string
  ci:            string | null
  resultado:     'PENDIENTE' | 'PROMOVIDO' | 'REPROBADO'
  grupo:         GrupoEstudiante
  /** Curso de la gestión de destino en el que ya está inscrito (si lo está). */
  yaMatriculadoEn: string | null
}

export interface PropuestaMatricula {
  origen:  { id: number; anio: number }
  destino: { id: number; anio: number }
  curso:   { id: number; nombre: string; paralelo: string; turno: Turno }
  /** null = los promovidos de este curso egresan. */
  siguiente: { etiqueta: string } | null
  repite:    { etiqueta: string }
  cursosPromovidos:     CursoDestino[]
  cursosRepiten:        CursoDestino[]
  sugeridoPromovidosId: number | null
  sugeridoRepitenId:    number | null
  estudiantes: EstudiantePropuesta[]
  resumen: {
    total: number; promovidos: number; repiten: number; egresan: number
    sinResultado: number; noAplica: number; yaMatriculados: number; porMatricular: number
  }
}

// Mismo paralelo y turno > mismo paralelo > único curso posible > ninguno.
function sugerirCurso(opciones: CursoDestino[], origen: { paralelo: string; turno: Turno }): number | null {
  const exacto = opciones.find(o => o.paralelo === origen.paralelo && o.turno === origen.turno)
  if (exacto) return exacto.id
  const mismoParalelo = opciones.filter(o => o.paralelo === origen.paralelo)
  if (mismoParalelo.length === 1) return mismoParalelo[0].id
  return opciones.length === 1 ? opciones[0].id : null
}

export async function propuestaMatriculaCurso(
  origenId: number, cursoId: number, destinoId: number, db: Db = prisma,
): Promise<PropuestaMatricula> {
  const origen  = await gestionOError(origenId, db, 'origen')
  const destino = await gestionOError(destinoId, db, 'destino')
  validarOrden(origen, destino)

  const curso = await db.curso.findFirst({ where: { id: cursoId, gestionId: origen.id } })
  if (!curso) throw new ErrorDeUsuario('El curso no existe en la gestión de origen', 404)

  const inscripciones = await db.inscripcion.findMany({
    where:   { gestionId: origen.id, cursoId, estadoInscripcion: { in: [...ESTADOS_VIGENTES] } },
    include: { estudiante: { select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } } } },
    orderBy: { estudiante: { persona: { apellido: 'asc' } } },
  })

  const enDestino = await db.inscripcion.findMany({
    where:  { gestionId: destino.id, estudianteId: { in: inscripciones.map(i => i.estudianteId) } },
    select: { estudianteId: true, curso: { select: { nivel: true, grado: true, paralelo: true, turno: true } } },
  })
  const matriculadoEn = new Map(enDestino.map(i => [i.estudianteId, nombreCurso(i.curso)]))

  const siguiente = siguienteNivelGrado(curso.nivel, curso.grado)

  const cursosDestino = await db.curso.findMany({
    where:   { gestionId: destino.id, activo: true },
    include: { _count: { select: { inscripciones: { where: { estadoInscripcion: 'ACTIVA' } } } } },
    orderBy: [{ paralelo: 'asc' }, { turno: 'asc' }],
  })
  const aOpcion = (c: (typeof cursosDestino)[number]): CursoDestino => ({
    id: c.id, nombre: nombreCurso(c), paralelo: c.paralelo, turno: c.turno,
    capacidad: c.capacidad, inscritos: c._count.inscripciones,
  })
  const cursosPromovidos = siguiente
    ? cursosDestino.filter(c => c.nivel === siguiente.nivel && c.grado === siguiente.grado).map(aOpcion)
    : []
  const cursosRepiten = cursosDestino.filter(c => c.nivel === curso.nivel && c.grado === curso.grado).map(aOpcion)

  const estudiantes: EstudiantePropuesta[] = inscripciones.map(i => ({
    inscripcionId: i.id,
    estudianteId:  i.estudianteId,
    estudiante:    `${i.estudiante.persona.apellido} ${i.estudiante.persona.nombre}`,
    ci:            i.estudiante.persona.ci,
    resultado:     i.resultado,
    grupo:         grupoDe(i, curso),
    yaMatriculadoEn: matriculadoEn.get(i.estudianteId) ?? null,
  }))

  const cuenta = (g: GrupoEstudiante) => estudiantes.filter(e => e.grupo === g).length
  const elegibles = estudiantes.filter(e => e.grupo === 'PROMOVIDO' || e.grupo === 'REPITE')
  const yaMatriculados = elegibles.filter(e => e.yaMatriculadoEn).length

  return {
    origen, destino,
    curso: { id: curso.id, nombre: nombreCurso(curso), paralelo: curso.paralelo, turno: curso.turno },
    siguiente: siguiente ? { etiqueta: etiquetaGrado(siguiente) } : null,
    repite:    { etiqueta: etiquetaGrado(curso) },
    cursosPromovidos, cursosRepiten,
    sugeridoPromovidosId: sugerirCurso(cursosPromovidos, curso),
    sugeridoRepitenId:    sugerirCurso(cursosRepiten, curso),
    estudiantes,
    resumen: {
      total: estudiantes.length, promovidos: cuenta('PROMOVIDO'), repiten: cuenta('REPITE'), egresan: cuenta('EGRESA'),
      sinResultado: cuenta('SIN_RESULTADO'), noAplica: cuenta('NO_APLICA'),
      yaMatriculados, porMatricular: elegibles.length - yaMatriculados,
    },
  }
}

// ─── Matrícula en lote de UN curso ───────────────────────────────────────────
export interface PedidoMatricula {
  destinoId:          number
  cursoOrigenId:      number
  /** Curso del grado siguiente al que van los PROMOVIDOS seleccionados. */
  cursoPromovidosId?: number
  /** Curso del mismo grado al que van los REPROBADOS seleccionados. */
  cursoRepitenId?:    number
  inscripcionIds:     number[]
}

export interface ResultadoMatricula {
  solicitados:  number
  matriculados: number
  promovidos:   number
  repiten:      number
  errores:      { inscripcionId: number; estudiante: string; error: string }[]
}

// Valida que el curso elegido sea de la gestión de destino y del grado esperado.
async function cursoDeDestinoOError(
  id: number | undefined, destinoId: number, esperado: { nivel: Nivel; grado: number } | null,
  rol: string, db: Db,
): Promise<CursoBase | null> {
  if (id === undefined) return null
  if (!esperado) throw new ErrorDeUsuario(`No corresponde elegir un curso para ${rol}`)
  const curso = await db.curso.findFirst({
    where:  { id, gestionId: destinoId, activo: true },
    select: { id: true, nivel: true, grado: true, paralelo: true, turno: true },
  })
  if (!curso) throw new ErrorDeUsuario(`El curso elegido para ${rol} no existe o no está activo en la gestión de destino`, 404)
  if (curso.nivel !== esperado.nivel || curso.grado !== esperado.grado) {
    throw new ErrorDeUsuario(`El curso elegido para ${rol} debe ser de ${etiquetaGrado(esperado)}, no de ${etiquetaGrado(curso)}`)
  }
  return curso
}

// Pensado para llamarse dentro de prisma.$transaction (el controlador lo hace).
export async function matricularCurso(origenId: number, pedido: PedidoMatricula, db: Db = prisma): Promise<ResultadoMatricula> {
  const origen  = await gestionOError(origenId, db, 'origen')
  const destino = await gestionOError(pedido.destinoId, db, 'destino')
  validarOrden(origen, destino)

  const cursoOrigen = await db.curso.findFirst({ where: { id: pedido.cursoOrigenId, gestionId: origen.id } })
  if (!cursoOrigen) throw new ErrorDeUsuario('El curso no existe en la gestión de origen', 404)

  const siguiente = siguienteNivelGrado(cursoOrigen.nivel, cursoOrigen.grado)
  const cursoPromovidos = await cursoDeDestinoOError(pedido.cursoPromovidosId, destino.id, siguiente, 'los promovidos', db)
  const cursoRepiten    = await cursoDeDestinoOError(pedido.cursoRepitenId, destino.id,
    { nivel: cursoOrigen.nivel, grado: cursoOrigen.grado }, 'los repetidores', db)

  const ids = [...new Set(pedido.inscripcionIds)]
  const inscripciones = await db.inscripcion.findMany({
    where:   { id: { in: ids }, gestionId: origen.id, cursoId: cursoOrigen.id },
    include: { estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } },
  })
  const porId = new Map(inscripciones.map(i => [i.id, i]))

  const yaInscritos = await db.inscripcion.findMany({
    where:  { gestionId: destino.id, estudianteId: { in: inscripciones.map(i => i.estudianteId) } },
    select: { estudianteId: true, curso: { select: { nivel: true, grado: true, paralelo: true, turno: true } } },
  })
  const matriculadoEn = new Map(yaInscritos.map(i => [i.estudianteId, nombreCurso(i.curso)]))

  const errores: ResultadoMatricula['errores'] = []
  const aCrear: { estudianteId: number; cursoId: number; gestionId: number }[] = []
  let promovidos = 0
  let repiten = 0

  for (const id of ids) {
    const insc = porId.get(id)
    if (!insc) {
      errores.push({ inscripcionId: id, estudiante: `Inscripción ${id}`, error: 'No pertenece al curso de origen indicado' })
      continue
    }
    const nombre = `${insc.estudiante.persona.apellido} ${insc.estudiante.persona.nombre}`
    const falla = (error: string) => errores.push({ inscripcionId: id, estudiante: nombre, error })

    const grupo = grupoDe(insc, cursoOrigen)
    if (grupo === 'NO_APLICA')     { falla('Está retirado o transferido: no se matricula'); continue }
    if (grupo === 'SIN_RESULTADO') { falla('No tiene resultado final: registrarlo primero (Paso 1)'); continue }
    if (grupo === 'EGRESA')        { falla('Egresa de 6° Secundaria: no se matricula'); continue }

    const destinoCurso = grupo === 'PROMOVIDO' ? cursoPromovidos : cursoRepiten
    if (!destinoCurso) {
      falla(grupo === 'PROMOVIDO' ? 'Falta elegir el curso de destino de los promovidos' : 'Falta elegir el curso de destino de los repetidores')
      continue
    }
    if (matriculadoEn.has(insc.estudianteId)) { falla(`Ya está inscrito en ${matriculadoEn.get(insc.estudianteId)}`); continue }

    // Red de seguridad: la progresión según TODO su historial.
    try {
      await validarProgresionInscripcion(insc.estudianteId, destinoCurso, destino.anio, db)
    } catch (e) {
      if (e instanceof ErrorDeUsuario) { falla(e.message); continue }
      throw e
    }

    aCrear.push({ estudianteId: insc.estudianteId, cursoId: destinoCurso.id, gestionId: destino.id })
    if (grupo === 'PROMOVIDO') promovidos++; else repiten++
  }

  if (aCrear.length) {
    // skipDuplicates respeta la restricción única (estudiante, gestión) ante una doble pulsación.
    const { count } = await db.inscripcion.createMany({ data: aCrear, skipDuplicates: true })
    if (count < aCrear.length) {
      throw new ErrorDeUsuario('Algunos estudiantes ya fueron matriculados en otro momento: recargá la propuesta e intentá de nuevo', 409)
    }
  }

  return { solicitados: ids.length, matriculados: aCrear.length, promovidos, repiten, errores }
}