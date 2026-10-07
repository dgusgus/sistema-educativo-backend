// src/services/resultado-final.service.ts
//
// Resultado final del año (PROMOVIDO / REPROBADO) de cada estudiante.
//
// REGLA (única fuente de verdad — la usan la vista de Promoción y el
// registro individual de inscripciones):
//   · Todas las materias del curso deben tener su PromedioFinal.
//   · REPROBADO si ALGUNA materia tiene promedio final menor a
//     Gestion.notaMinimaAprobacion (51 por defecto).
//   · PROMOVIDO en cualquier otro caso.
//
// El resultado NUNCA lo elige quien registra: siempre sale de las notas
// que cargaron los docentes. Así nadie puede promover a un estudiante
// que reprobó, ni reprobar a uno que aprobó.
//
// Para cambiar la regla (p. ej. permitir hasta N materias reprobadas o
// un periodo de recuperación) basta con tocar decidirResultado().
//
// No requiere cambios en el schema: lee PromedioFinal y escribe solo
// Inscripcion.resultado, que ya existían.

import { prisma } from '../lib/prisma.js'
import { ErrorDeUsuario } from '../lib/errores.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'

export type ResultadoCalculado = 'PROMOVIDO' | 'REPROBADO'
export type ResultadoInscripcion = 'PENDIENTE' | ResultadoCalculado

export interface MateriaReprobada {
  materia:  string
  promedio: number
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

const redondear2 = (n: number) => Math.round(n * 100) / 100

// ─── Cálculo ─────────────────────────────────────────────────────────────────
// Solo lectura. Exige que todos los trimestres de la gestión estén
// cerrados (si no, los promedios finales todavía pueden cambiar).
export async function calcularResultadosGestion(
  gestionId: number,
  opciones: { inscripcionIds?: number[] } = {},
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

  const notaMinima = Number(gestion.notaMinimaAprobacion)

  // CONCLUIDA se incluye a propósito: después de cerrar la gestión todas las
  // inscripciones activas pasan a CONCLUIDA y igual deben poder verificarse.
  const inscripciones = await prisma.inscripcion.findMany({
    where: {
      gestionId,
      estadoInscripcion: { in: ['ACTIVA', 'CONCLUIDA'] },
      ...(opciones.inscripcionIds ? { id: { in: opciones.inscripcionIds } } : {}),
    },
    include: {
      estudiante: { select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } } },
      curso:      { select: { id: true, nivel: true, grado: true, paralelo: true } },
      promediosFinales: { select: { docenteMateriaCursoId: true, promedioFinal: true } },
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

  const resultados: CalculoResultado[] = inscripciones.map(insc => {
    const esperadas   = materiasPorCurso.get(insc.curso.id) ?? []
    const promedios   = new Map(insc.promediosFinales.map(p => [p.docenteMateriaCursoId, Number(p.promedioFinal)]))

    const sinPromedio = esperadas.filter(m => !promedios.has(m.id)).map(m => m.nombre)
    const reprobadas: MateriaReprobada[] = esperadas
      .filter(m => promedios.has(m.id) && (promedios.get(m.id) as number) < notaMinima)
      .map(m => ({ materia: m.nombre, promedio: promedios.get(m.id) as number }))

    const valores = esperadas.filter(m => promedios.has(m.id)).map(m => promedios.get(m.id) as number)
    const promedioGeneral = valores.length ? redondear2(valores.reduce((a, b) => a + b, 0) / valores.length) : null

    let detalle: string | null = null
    if (esperadas.length === 0)    detalle = 'El curso no tiene materias asignadas'
    else if (sinPromedio.length)   detalle = `Falta el promedio final de: ${sinPromedio.join(', ')}`

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
export async function registrarResultadosLote(gestionId: number, inscripcionIds: number[]): Promise<ResultadoLote> {
  const ids = [...new Set(inscripcionIds)]
  const { resultados } = await calcularResultadosGestion(gestionId, { inscripcionIds: ids })

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