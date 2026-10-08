// src/services/resultado-final.service.ts
//
// Resultado final del año (PROMOVIDO / REPROBADO) de cada estudiante.
//
// REGLA (única fuente de verdad — la usan la vista de Promoción y el
// registro individual de inscripciones):
//   · Todas las materias del curso deben tener nota en TODOS los trimestres.
//   · El promedio final de cada materia es el promedio de sus trimestrales
//     (promedio-final.helper.ts → promedioFinalDe).
//   · REPROBADO si ALGUNA materia tiene promedio final menor a
//     Gestion.notaMinimaAprobacion (51 por defecto).
//   · PROMOVIDO en cualquier otro caso.
//
// Se calcula desde Calificacion.promedioTrimestral (la fuente real) y NO desde
// la tabla PromedioFinal: esa tabla es una copia que solo se actualiza al
// cerrar un trimestre o corregir una nota, y si quedara desactualizada se
// promovería a un estudiante con una materia reprobada.
//
// El resultado NUNCA lo elige quien registra: siempre sale de las notas
// que cargaron los docentes. Así nadie puede promover a un estudiante
// que reprobó, ni reprobar a uno que aprobó.
//
// Para cambiar la regla (p. ej. permitir hasta N materias reprobadas o
// un periodo de recuperación) basta con tocar decidirResultado().
//
// No requiere cambios en el schema. El cálculo es de solo lectura; el registro
// en lote escribe Inscripcion.resultado y deja PromedioFinal al día.

import { prisma } from '../lib/prisma.js'
import { ErrorDeUsuario } from '../lib/errores.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'
import { promedioFinalDe, calcularPromediosFinales, redondear2 } from '../lib/promedio-final.helper.js'

export type ResultadoCalculado = 'PROMOVIDO' | 'REPROBADO'
export type ResultadoInscripcion = 'PENDIENTE' | ResultadoCalculado

export interface MateriaReprobada {
  materia:  string
  promedio: number
}

export interface PromedioMateria {
  materia:  string
  /** null si todavía faltan trimestres de esa materia. */
  promedio: number | null
}

export interface CalculoResultado {
  inscripcionId:       number
  estudianteId:        number
  estudiante:          string
  ci:                  string | null
  curso:               string
  resultadoActual:     ResultadoInscripcion
  /** LISTO = tiene todos los promedios finales; INCOMPLETO = falta algo. */
  estado:              'LISTO' | 'INCOMPLETO'
  /** null cuando el estado es INCOMPLETO. */
  sugerido:            ResultadoCalculado | null
  promedioGeneral:     number | null
  totalMaterias:       number
  /** Todas las materias del curso con su promedio final calculado. */
  materias:            PromedioMateria[]
  materiasReprobadas:  MateriaReprobada[]
  materiasSinPromedio: string[]
  /** Explicación legible cuando el estado es INCOMPLETO. */
  detalle:             string | null
}

export interface ResumenCalculo {
  total:       number
  promovidos:  number
  reprobados:  number
  incompletos: number
  /** Listos cuyo resultado actual ya coincide con el calculado. */
  yaRegistrados: number
  /** Listos cuyo resultado todavía no coincide (hay que registrarlo). */
  porRegistrar:  number
}

// ─── Regla de negocio ────────────────────────────────────────────────────────
function decidirResultado(materiasReprobadas: MateriaReprobada[]): ResultadoCalculado {
  return materiasReprobadas.length > 0 ? 'REPROBADO' : 'PROMOVIDO'
}

// ─── Cálculo ─────────────────────────────────────────────────────────────────
// Solo lectura. Exige que todos los trimestres de la gestión estén
// cerrados (si no, los promedios finales todavía pueden cambiar).
export async function calcularResultadosGestion(
  gestionId: number,
  opciones: { inscripcionIds?: number[]; cursoId?: number } = {},
): Promise<{ gestion: { id: number; anio: number; notaMinima: number }; resumen: ResumenCalculo; resultados: CalculoResultado[] }> {
  const gestion = await prisma.gestion.findUnique({
    where:  { id: gestionId },
    select: { id: true, anio: true, notaMinimaAprobacion: true },
  })
  if (!gestion) throw new ErrorDeUsuario('Gestión no encontrada', 404)

  const trimestresAbiertos = await prisma.trimestre.findMany({
    where:  { gestionId, cerrado: false },
    select: { nombre: true },
  })
  if (trimestresAbiertos.length > 0) {
    throw new ErrorDeUsuario(
      `No se puede calcular el resultado — hay trimestres sin cerrar: ${trimestresAbiertos.map(t => t.nombre).join(', ')}`,
    )
  }

  // Promoción por curso: se calcula solo el curso pedido (debe ser de esta gestión).
  if (opciones.cursoId !== undefined) {
    const curso = await prisma.curso.findFirst({ where: { id: opciones.cursoId, gestionId }, select: { id: true } })
    if (!curso) throw new ErrorDeUsuario('El curso no existe en esta gestión', 404)
  }

  const notaMinima = Number(gestion.notaMinimaAprobacion)

  // CONCLUIDA se incluye a propósito: después de cerrar la gestión todas las
  // inscripciones activas pasan a CONCLUIDA y igual deben poder verificarse.
  const inscripciones = await prisma.inscripcion.findMany({
    where: {
      gestionId,
      estadoInscripcion: { in: ['ACTIVA', 'CONCLUIDA'] },
      ...(opciones.cursoId !== undefined ? { cursoId: opciones.cursoId } : {}),
      ...(opciones.inscripcionIds ? { id: { in: opciones.inscripcionIds } } : {}),
    },
    include: {
      estudiante: { select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } } },
      curso:      { select: { id: true, nivel: true, grado: true, paralelo: true } },
    },
    orderBy: [
      { curso: { nivel: 'asc' } },
      { curso: { grado: 'asc' } },
      { curso: { paralelo: 'asc' } },
      { estudiante: { persona: { apellido: 'asc' } } },
    ],
  })

  // Materias que debe tener cada curso en esta gestión (una por asignación).
  const asignaciones = await prisma.docenteMateriaCurso.findMany({
    where:  { gestionId },
    select: { id: true, cursoId: true, materia: { select: { nombre: true } } },
  })
  const materiasPorCurso = new Map<number, { id: number; nombre: string }[]>()
  for (const a of asignaciones) {
    const lista = materiasPorCurso.get(a.cursoId) ?? []
    lista.push({ id: a.id, nombre: a.materia.nombre })
    materiasPorCurso.set(a.cursoId, lista)
  }

  // Notas de cada trimestre: inscripción → materia → (trimestre → promedio).
  const totalTrimestres = await prisma.trimestre.count({ where: { gestionId } })
  const calificaciones = await prisma.calificacion.findMany({
    where: {
      docenteMateriaCurso: { gestionId },
      promedioTrimestral:  { not: null },
      inscripcionId:       { in: inscripciones.map(i => i.id) },
    },
    select: { inscripcionId: true, docenteMateriaCursoId: true, trimestreId: true, promedioTrimestral: true },
  })
  const notas = new Map<number, Map<number, Map<number, number>>>()
  for (const c of calificaciones) {
    const porMateria   = notas.get(c.inscripcionId) ?? new Map<number, Map<number, number>>()
    const porTrimestre = porMateria.get(c.docenteMateriaCursoId) ?? new Map<number, number>()
    porTrimestre.set(c.trimestreId, Number(c.promedioTrimestral))
    porMateria.set(c.docenteMateriaCursoId, porTrimestre)
    notas.set(c.inscripcionId, porMateria)
  }

  const resultados: CalculoResultado[] = inscripciones.map(insc => {
    const esperadas = materiasPorCurso.get(insc.curso.id) ?? []

    // Promedio final de cada materia, calculado en el momento (null = faltan trimestres).
    const promedios = new Map<number, number>()
    for (const m of esperadas) {
      const trimestres = notas.get(insc.id)?.get(m.id)
      const final = trimestres ? promedioFinalDe([...trimestres.values()], totalTrimestres) : null
      if (final !== null) promedios.set(m.id, final)
    }

    const sinPromedio = esperadas.filter(m => !promedios.has(m.id)).map(m => m.nombre)
    const reprobadas: MateriaReprobada[] = esperadas
      .filter(m => promedios.has(m.id) && (promedios.get(m.id) as number) < notaMinima)
      .map(m => ({ materia: m.nombre, promedio: promedios.get(m.id) as number }))

    const valores = esperadas.filter(m => promedios.has(m.id)).map(m => promedios.get(m.id) as number)
    const promedioGeneral = valores.length ? redondear2(valores.reduce((a, b) => a + b, 0) / valores.length) : null

    let detalle: string | null = null
    if (esperadas.length === 0)    detalle = 'El curso no tiene materias asignadas'
    else if (sinPromedio.length)   detalle = `Faltan notas de algún trimestre en: ${sinPromedio.join(', ')}`

    const listo = detalle === null

    return {
      inscripcionId:       insc.id,
      estudianteId:        insc.estudiante.id,
      estudiante:          `${insc.estudiante.persona.apellido} ${insc.estudiante.persona.nombre}`,
      ci:                  insc.estudiante.persona.ci,
      curso:               `${insc.curso.grado}° ${NIVEL_TEXTO[insc.curso.nivel]} "${insc.curso.paralelo}"`,
      resultadoActual:     insc.resultado as ResultadoInscripcion,
      estado:              listo ? 'LISTO' : 'INCOMPLETO',
      sugerido:            listo ? decidirResultado(reprobadas) : null,
      promedioGeneral,
      totalMaterias:       esperadas.length,
      materias:            esperadas.map(m => ({ materia: m.nombre, promedio: promedios.get(m.id) ?? null })),
      materiasReprobadas:  reprobadas,
      materiasSinPromedio: sinPromedio,
      detalle,
    }
  })

  const listos = resultados.filter(r => r.estado === 'LISTO')
  const resumen: ResumenCalculo = {
    total:         resultados.length,
    promovidos:    listos.filter(r => r.sugerido === 'PROMOVIDO').length,
    reprobados:    listos.filter(r => r.sugerido === 'REPROBADO').length,
    incompletos:   resultados.length - listos.length,
    yaRegistrados: listos.filter(r => r.resultadoActual === r.sugerido).length,
    porRegistrar:  listos.filter(r => r.resultadoActual !== r.sugerido).length,
  }

  return { gestion: { id: gestion.id, anio: gestion.anio, notaMinima }, resumen, resultados }
}

// Cálculo de UNA inscripción (lo usa el registro individual).
export async function calcularResultadoInscripcion(inscripcionId: number): Promise<CalculoResultado> {
  const insc = await prisma.inscripcion.findUnique({
    where:  { id: inscripcionId },
    select: { gestionId: true, estadoInscripcion: true },
  })
  if (!insc) throw new ErrorDeUsuario('Inscripción no encontrada', 404)
  if (insc.estadoInscripcion === 'RETIRADA' || insc.estadoInscripcion === 'TRANSFERIDA') {
    throw new ErrorDeUsuario('No se registra resultado a estudiantes retirados o transferidos')
  }

  const { resultados } = await calcularResultadosGestion(insc.gestionId, { inscripcionIds: [inscripcionId] })
  const calculo = resultados[0]
  if (!calculo) throw new ErrorDeUsuario('Inscripción no encontrada', 404)
  return calculo
}

// ─── Registro en lote ────────────────────────────────────────────────────────
export interface ResultadoLote {
  solicitados:  number
  actualizados: number
  promovidos:   number
  reprobados:   number
  sinCambios:   number
  errores:      { inscripcionId: number; estudiante: string; error: string }[]
}

// Registra el resultado CALCULADO por el servidor para cada inscripción
// pedida. Lo que mande el navegador es solo la lista de ids: jamás el
// resultado. Las inscripciones incompletas se rechazan una por una y no
// frenan al resto. Las escrituras van en una sola transacción.
export async function registrarResultadosLote(
  gestionId: number,
  inscripcionIds: number[],
  cursoId?: number,
): Promise<ResultadoLote> {
  const ids = [...new Set(inscripcionIds)]
  const { resultados } = await calcularResultadosGestion(gestionId, { inscripcionIds: ids, cursoId })

  // Deja la tabla PromedioFinal igual a lo que se calculó (boletines y reportes
  // la leen). Solo escribe lo que cambió, así que normalmente no toca nada.
  const asignaciones = await prisma.docenteMateriaCurso.findMany({
    where:  { gestionId, ...(cursoId !== undefined ? { cursoId } : {}) },
    select: { id: true },
  })
  for (const a of asignaciones) await calcularPromediosFinales(a.id, gestionId)

  const porId = new Map(resultados.map(r => [r.inscripcionId, r]))
  const errores: ResultadoLote['errores'] = []
  const aPromover: number[] = []
  const aReprobar: number[] = []
  let sinCambios = 0

  for (const id of ids) {
    const r = porId.get(id)
    if (!r) {
      errores.push({ inscripcionId: id, estudiante: `Inscripción ${id}`, error: 'No pertenece a esta gestión o no está activa' })
    } else if (r.estado === 'INCOMPLETO' || r.sugerido === null) {
      errores.push({ inscripcionId: id, estudiante: r.estudiante, error: r.detalle ?? 'Faltan promedios finales' })
    } else if (r.resultadoActual === r.sugerido) {
      sinCambios++
    } else if (r.sugerido === 'PROMOVIDO') {
      aPromover.push(id)
    } else {
      aReprobar.push(id)
    }
  }

  if (aPromover.length || aReprobar.length) {
    await prisma.$transaction([
      prisma.inscripcion.updateMany({ where: { id: { in: aPromover } }, data: { resultado: 'PROMOVIDO' } }),
      prisma.inscripcion.updateMany({ where: { id: { in: aReprobar } }, data: { resultado: 'REPROBADO' } }),
    ])
  }

  return {
    solicitados:  ids.length,
    actualizados: aPromover.length + aReprobar.length,
    promovidos:   aPromover.length,
    reprobados:   aReprobar.length,
    sinCambios,
    errores,
  }
}