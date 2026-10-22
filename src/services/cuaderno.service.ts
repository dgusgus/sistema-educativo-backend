// src/services/cuaderno.service.ts
//
// Reúne TODOS los datos del "cuaderno pedagógico" de un curso en un trimestre:
// carátula, filiación y, por cada área, el registro de valoración.
//
// ¿Para qué un servicio aparte? Porque el cuaderno se dibujará en Excel ahora y en
// PDF después. Este archivo decide QUÉ datos van (una sola vez, con pocas consultas);
// quien dibuja (lib/excel/cuaderno.builder.ts) solo decide CÓMO se ven.
//
// Consultas: son 8 en total, sin importar cuántos estudiantes o áreas haya
// (nada de una consulta por estudiante).

import { armarHorario, horaTexto, type HorarioCurso, type DiaHorario } from '../lib/cuaderno.horario.js'
import { prisma } from '../lib/prisma.js'
import type { EstadoAsistencia } from '../../prisma/generated/prisma/enums.js'
import { ErrorDeUsuario, NoEncontrado } from '../lib/errores.js'
import {
  autoevaluacion, desarrolloCurricular, gradoEnTexto, nivelEnTexto, redondear, resumirNotas,
  turnoEnTexto, calcularAnual, resumirCentralizador, type ObservacionAnual, type ResumenCentralizador, type ResumenNotas,
} from '../lib/cuaderno.calculo.js'
import {
  NOMBRE_MES, ABREVIATURA_MES, contarLetras, diasDelMes, estadoDelDia, fechaISO, mesesDelRango,
  type DiaCalendario, type LetraAsistencia,
} from '../lib/cuaderno.asistencia.js'

// ─── Forma de los datos ──────────────────────────────────────────────────────

export interface Familiar {
  nombre: string
  ocupacion: string
  telefono: string
}

export interface EstudianteCuaderno {
  inscripcionId: number
  numero: number
  rude: string
  apellidos: string
  nombres: string
  /** "APELLIDOS NOMBRES" en mayúsculas, como aparece en todas las hojas del Excel */
  nombreCompleto: string
  telefono: string
  /** Dirección del estudiante; si no tiene, la de su tutor principal */
  direccion: string
  madre: Familiar | null
  padre: Familiar | null
}

export interface ActividadCuaderno {
  id: number
  nombre: string
  puntajeMaximo: number
}

export interface DimensionAreaCuaderno {
  dimensionId: number
  nombre: string
  puntajeMaximo: number
  esAutoevaluada: boolean
  actividades: ActividadCuaderno[]
}

export interface FilaAreaCuaderno {
  inscripcionId: number
  /** actividadId → nota (solo las que tienen nota) */
  notas: Record<number, number>
  /** dimensionId → promedio de la dimensión en su escala */
  promedioDimension: Record<number, number>
  desarrollo: number | null
  autoevaluacion: number | null
  /** nota del trimestre (0-100), entera como en el Excel; null si no hay nota */
  total: number | null
}

export interface FilaCentralizador {
  inscripcionId: number
  /** trimestreId → nota del trimestre (entera, como en el cuaderno); null si aún no tiene */
  porTrimestre: Record<number, number | null>
  promedioAnual: number | null
  resultado: ObservacionAnual | null
}

export interface CentralizadorArea {
  filas: FilaCentralizador[]
  resumen: ResumenCentralizador
}

export interface AreaCuaderno {
  docenteMateriaCursoId: number
  materia: string
  codigo: string
  campoSaber: string
  docente: string
  dimensiones: DimensionAreaCuaderno[]
  filas: FilaAreaCuaderno[]
  resumen: ResumenNotas
  centralizador: CentralizadorArea
}

export interface FilaAsistenciaMes {
  inscripcionId: number
  /** "AAAA-MM-DD" → A/F/R/L; los días sin registro no aparecen */
  estados: Record<string, LetraAsistencia>
  totales: Record<LetraAsistencia, number>
}

export interface MesAsistencia {
  anio: number
  mes: number
  nombre: string        // "FEBRERO"
  abreviatura: string   // "FEB" (nombre de la hoja)
  dias: DiaCalendario[]
  /** días en los que se pasó lista a alguien del curso (los demás son feriado / sin clase) */
  diasConRegistro: string[]
  filas: FilaAsistenciaMes[]
}

export interface DatosCuaderno {
  institucion: {
    nombre: string
    rue: string
    municipio: string
    distrito: string
    departamento: string
  }
  /** Director(a) de la gestión; vacío si la gestión no tiene uno asignado */
  director: string
  gestion: { anio: number; notaMinimaAprobacion: number }
  curso: {
    nivel: string
    grado: string
    paralelo: string
    turno: string
  }
  /** Maestro de aula (tutor del curso); si no hay, el docente con más áreas */
  docentePrincipal: string
  trimestre: { id: number; numero: number; nombre: string }
  /** Todos los trimestres de la gestión (columnas del centralizador) */
  trimestres: Array<{ id: number; numero: number; nombre: string }>
  estudiantes: EstudianteCuaderno[]
  /** Un mes por cada mes que toca el trimestre, en orden */
  asistencia: MesAsistencia[]
  areas: AreaCuaderno[]
  /** false si se filtró por docente: los promedios generales (boletín, mejores, libretas) no serían reales */
  areasCompletas: boolean
  /** Horario del curso completo (no depende del filtro por docente) */
  horario: HorarioCurso
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

const mayus = (s: string | null | undefined): string => (s ?? '').trim().toUpperCase()
const nombrePersona = (p: { nombre: string; apellido: string }): string => `${p.nombre} ${p.apellido}`.trim()

interface TutorConPersona {
  parentesco: string
  esTutorPrincipal: boolean
  tutor: { ocupacion: string | null; persona: { nombre: string; apellido: string; telefono: string | null } }
}

function aFamiliar(v: TutorConPersona | undefined): Familiar | null {
  if (!v) return null
  return {
    nombre: nombrePersona(v.tutor.persona),
    ocupacion: v.tutor.ocupacion ?? '',
    telefono: v.tutor.persona.telefono ?? '',
  }
}

// ─── Servicio ────────────────────────────────────────────────────────────────

/**
 * @param soloDocenteId  si se indica, solo se incluyen las áreas de ese docente
 *                       (un docente no debe ver las notas de áreas ajenas).
 */
export async function obtenerDatosCuaderno(
  cursoId: number,
  trimestreId: number,
  soloDocenteId?: number,
): Promise<DatosCuaderno> {
  const curso = await prisma.curso.findUnique({
    where: { id: cursoId },
    select: {
      id: true, nivel: true, grado: true, paralelo: true, turno: true, gestionId: true,
      gestion: { select: { anio: true, notaMinimaAprobacion: true, director: { select: { persona: { select: { nombre: true, apellido: true } } } } } },
      tutorDocente: { select: { persona: { select: { nombre: true, apellido: true } } } },
    },
  })
  if (!curso) throw new NoEncontrado('Curso')

  const trimestre = await prisma.trimestre.findUnique({
    where: { id: trimestreId },
    select: { id: true, numero: true, nombre: true, gestionId: true, fechaInicio: true, fechaFin: true },
  })
  if (!trimestre) throw new NoEncontrado('Trimestre')
  if (trimestre.gestionId !== curso.gestionId) {
    throw new ErrorDeUsuario('El trimestre no pertenece a la gestión de este curso')
  }

  const [institucion, trimestresGestion, dimensionesGestion, asignaciones, inscripciones] = await Promise.all([
    prisma.institucion.findFirst({ select: { nombre: true, rue: true, municipio: true, distrito: true, departamento: true } }),
    prisma.trimestre.findMany({
      where: { gestionId: curso.gestionId }, orderBy: { numero: 'asc' }, select: { id: true, numero: true, nombre: true },
    }),
    prisma.dimensionEvaluacion.findMany({
      where: { gestionId: curso.gestionId },
      orderBy: { orden: 'asc' },
      select: { id: true, nombre: true, puntajeMaximo: true, esAutoevaluada: true },
    }),
    prisma.docenteMateriaCurso.findMany({
      where: { cursoId, ...(soloDocenteId !== undefined ? { docenteId: soloDocenteId } : {}) },
      select: {
        id: true,
        docente: { select: { persona: { select: { nombre: true, apellido: true } } } },
        materia: {
          select: { nombre: true, codigo: true, campoSaber: { select: { nombre: true, orden: true } } },
        },
      },
    }),
    prisma.inscripcion.findMany({
      where: { cursoId, estadoInscripcion: 'ACTIVA' },
      orderBy: [
        { estudiante: { persona: { apellido: 'asc' } } },
        { estudiante: { persona: { nombre: 'asc' } } },
      ],
      select: {
        id: true,
        estudiante: {
          select: {
            rude: true,
            persona: { select: { nombre: true, apellido: true, telefono: true, direccion: true } },
            tutores: {
              select: {
                parentesco: true,
                esTutorPrincipal: true,
                tutor: { select: { ocupacion: true, persona: { select: { nombre: true, apellido: true, telefono: true, direccion: true } } } },
              },
            },
          },
        },
      },
    }),
  ])

  // Mismo orden que el boletín: por campo de saber y luego por nombre.
  asignaciones.sort((a, b) => {
    const oa = a.materia.campoSaber?.orden ?? Number.MAX_SAFE_INTEGER
    const ob = b.materia.campoSaber?.orden ?? Number.MAX_SAFE_INTEGER
    return oa !== ob ? oa - ob : a.materia.nombre.localeCompare(b.materia.nombre)
  })

  const dmcIds = asignaciones.map(a => a.id)
  const inscripcionIds = inscripciones.map(i => i.id)

  const [actividades, calificaciones, asistencias, trimestrales] = await Promise.all([
    dmcIds.length
      ? prisma.actividadEvaluativa.findMany({
          where: { docenteMateriaCursoId: { in: dmcIds }, trimestreId, activo: true },
          orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
          select: { id: true, nombre: true, puntajeMaximo: true, dimensionId: true, docenteMateriaCursoId: true },
        })
      : Promise.resolve([]),
    dmcIds.length && inscripcionIds.length
      ? prisma.calificacion.findMany({
          where: { trimestreId, docenteMateriaCursoId: { in: dmcIds }, inscripcionId: { in: inscripcionIds } },
          select: {
            inscripcionId: true, docenteMateriaCursoId: true, promedioTrimestral: true,
            dimensiones: { select: { dimensionId: true, promedio: true } },
          },
        })
      : Promise.resolve([]),
    // Asistencia del trimestre: una sola consulta para todo el curso. Se toman las
    // materias incluidas (todas, o solo las del docente si no es administración).
    dmcIds.length && inscripcionIds.length
      ? prisma.asistencia.findMany({
          where: { trimestreId, docenteMateriaCursoId: { in: dmcIds }, inscripcionId: { in: inscripcionIds } },
          select: { inscripcionId: true, fecha: true, estado: true },
        })
      : Promise.resolve([]),
    // Nota de cada trimestre de la gestión (centralizador): una consulta para todas las áreas.
    dmcIds.length && inscripcionIds.length
      ? prisma.calificacion.findMany({
          where: { docenteMateriaCursoId: { in: dmcIds }, inscripcionId: { in: inscripcionIds }, promedioTrimestral: { not: null } },
          select: { inscripcionId: true, docenteMateriaCursoId: true, trimestreId: true, promedioTrimestral: true },
        })
      : Promise.resolve([]),
  ])

  const notas =actividades.length && inscripcionIds.length
    ? await prisma.notaActividad.findMany({
        where: { actividadEvaluativaId: { in: actividades.map(a => a.id) }, inscripcionId: { in: inscripcionIds } },
        select: { actividadEvaluativaId: true, inscripcionId: true, nota: true },
      })
    : []

  // ─── Índices (para no buscar dentro de bucles) ─────────────────────────────
  const notaDe = new Map<string, number>()                       // "inscripcion-actividad" → nota
  for (const n of notas) notaDe.set(`${n.inscripcionId}-${n.actividadEvaluativaId}`, Number(n.nota))

  const trimestralDe = new Map<string, number>()                 // "inscripcion-dmc-trimestre" → nota (con decimales)
  for (const t of trimestrales) trimestralDe.set(`${t.inscripcionId}-${t.docenteMateriaCursoId}-${t.trimestreId}`, Number(t.promedioTrimestral))

  const calificacionDe = new Map<string, (typeof calificaciones)[number]>()   // "inscripcion-dmc"
  for (const c of calificaciones) calificacionDe.set(`${c.inscripcionId}-${c.docenteMateriaCursoId}`, c)

  // ─── Estudiantes ───────────────────────────────────────────────────────────
  const estudiantes: EstudianteCuaderno[] = inscripciones.map((i, idx) => {
    const p = i.estudiante.persona
    const madre = aFamiliar(i.estudiante.tutores.find(t => t.parentesco === 'MADRE'))
    // "Padre o tutor": el padre; si no hay, el tutor legal, y si no, el tutor principal.
    const padre = aFamiliar(
      i.estudiante.tutores.find(t => t.parentesco === 'PADRE')
      ?? i.estudiante.tutores.find(t => t.parentesco === 'TUTOR_LEGAL')
      ?? i.estudiante.tutores.find(t => t.esTutorPrincipal && t.parentesco !== 'MADRE'),
    )
    return {
      inscripcionId: i.id,
      numero: idx + 1,
      rude: i.estudiante.rude ?? '',
      apellidos: mayus(p.apellido),
      nombres: mayus(p.nombre),
      nombreCompleto: `${mayus(p.apellido)} ${mayus(p.nombre)}`.trim(),
      // Contacto: el del estudiante; si no tiene, el de su familia.
      telefono: p.telefono ?? padre?.telefono ?? madre?.telefono ?? '',
      direccion: p.direccion
        || i.estudiante.tutores.find(t => t.esTutorPrincipal)?.tutor.persona.direccion
        || i.estudiante.tutores.find(t => t.tutor.persona.direccion)?.tutor.persona.direccion
        || '',
      madre,
      padre,
    }
  })

  // ─── Horario del curso ─────────────────────────────────────────────────────
  const filasHorario = await prisma.horario.findMany({
    where: { docenteMateriaCurso: { cursoId } },
    select: {
      diaSemana: true, horaInicio: true, horaFin: true, aula: true,
      docenteMateriaCurso: { select: { materia: { select: { nombre: true } } } },
    },
  })
  const horario = armarHorario(filasHorario.map(h => ({
    dia: h.diaSemana as DiaHorario,
    inicio: horaTexto(h.horaInicio),
    fin: horaTexto(h.horaFin),
    materia: mayus(h.docenteMateriaCurso.materia.nombre),
    aula: h.aula,
  })))

  // ─── Áreas ─────────────────────────────────────────────────────────────────
  const areas: AreaCuaderno[] = asignaciones.map(a => {
    const delArea = actividades.filter(act => act.docenteMateriaCursoId === a.id)

    const dimensiones: DimensionAreaCuaderno[] = dimensionesGestion.map(d => ({
      dimensionId: d.id,
      nombre: d.nombre,
      puntajeMaximo: Number(d.puntajeMaximo),
      esAutoevaluada: d.esAutoevaluada,
      actividades: delArea
        .filter(act => act.dimensionId === d.id)
        .map(act => ({ id: act.id, nombre: act.nombre, puntajeMaximo: Number(act.puntajeMaximo) })),
    }))

    const filas: FilaAreaCuaderno[] = inscripciones.map(i => {
      const notasFila: Record<number, number> = {}
      for (const act of delArea) {
        const n = notaDe.get(`${i.id}-${act.id}`)
        if (n !== undefined) notasFila[act.id] = n
      }

      const cal = calificacionDe.get(`${i.id}-${a.id}`)
      const promedioDimension: Record<number, number> = {}
      for (const cd of cal?.dimensiones ?? []) promedioDimension[cd.dimensionId] = Number(cd.promedio)

      const puntos = dimensiones.map(d => ({
        esAutoevaluada: d.esAutoevaluada,
        promedio: promedioDimension[d.dimensionId] ?? null,
      }))
      const total = cal?.promedioTrimestral != null ? redondear(Number(cal.promedioTrimestral)) : null

      return {
        inscripcionId: i.id,
        notas: notasFila,
        promedioDimension,
        desarrollo: desarrolloCurricular(puntos),
        autoevaluacion: autoevaluacion(puntos),
        total,
      }
    })

    const notaMinima = Number(curso.gestion.notaMinimaAprobacion)
    const filasCentralizador: FilaCentralizador[] = inscripciones.map(i => {
      const exactas = trimestresGestion.map(t => trimestralDe.get(`${i.id}-${a.id}-${t.id}`) ?? null)
      const anual = calcularAnual(exactas, notaMinima)
      const porTrimestre: Record<number, number | null> = {}
      trimestresGestion.forEach((t, k) => { porTrimestre[t.id] = exactas[k] === null ? null : redondear(exactas[k]!) })
      return { inscripcionId: i.id, porTrimestre, promedioAnual: anual.promedio, resultado: anual.resultado }
    })

    return {
      docenteMateriaCursoId: a.id,
      materia: mayus(a.materia.nombre),
      codigo: a.materia.codigo,
      campoSaber: mayus(a.materia.campoSaber?.nombre),
      docente: nombrePersona(a.docente.persona),
      dimensiones,
      filas,
      resumen: resumirNotas(filas.map(f => f.total), notaMinima),
      centralizador: { filas: filasCentralizador, resumen: resumirCentralizador(filasCentralizador.map(f => ({ promedio: f.promedioAnual, resultado: f.resultado }))) },
    }
  })

  // ─── Asistencia mensual ────────────────────────────────────────────────────
  // Se reduce a UN estado por estudiante y día (ver lib/cuaderno.asistencia.ts) y se
  // agrupa por mes. Un mes por cada mes que toca el trimestre, aunque no tenga registros:
  // así el maestro puede imprimir el calendario en blanco, como el cuaderno de papel.
  const registrosDelDia = new Map<string, EstadoAsistencia[]>()   // "inscripcion|fecha" → estados
  const fechasConRegistro = new Set<string>()
  for (const a of asistencias) {
    const f = fechaISO(a.fecha)
    fechasConRegistro.add(f)
    const clave = `${a.inscripcionId}|${f}`
    const lista = registrosDelDia.get(clave)
    if (lista) lista.push(a.estado)
    else registrosDelDia.set(clave, [a.estado])
  }
  const desde = fechaISO(trimestre.fechaInicio)
  const hasta = fechaISO(trimestre.fechaFin)
  const sabadosConRegistro = new Set([...fechasConRegistro].filter(f => new Date(`${f}T00:00:00Z`).getUTCDay() === 6))

  const asistencia: MesAsistencia[] = mesesDelRango(desde, hasta).map(({ anio, mes }) => {
    const dias = diasDelMes(anio, mes, desde, hasta, sabadosConRegistro)
    const filas: FilaAsistenciaMes[] = inscripciones.map(i => {
      const estados: Record<string, LetraAsistencia> = {}
      for (const d of dias) {
        const registros = registrosDelDia.get(`${i.id}|${d.fecha}`)
        const letra = registros ? estadoDelDia(registros) : null
        if (letra) estados[d.fecha] = letra
      }
      return { inscripcionId: i.id, estados, totales: contarLetras(Object.values(estados)) }
    })
    return {
      anio, mes,
      nombre: NOMBRE_MES[mes],
      abreviatura: ABREVIATURA_MES[mes],
      dias,
      diasConRegistro: dias.filter(d => fechasConRegistro.has(d.fecha)).map(d => d.fecha),
      filas,
    }
  })

  // Maestro de aula: el tutor del curso; si no hay, quien dicta más áreas.
  let docentePrincipal = curso.tutorDocente ? nombrePersona(curso.tutorDocente.persona) : ''
  if (!docentePrincipal && asignaciones.length > 0) {
    const cuenta = new Map<string, number>()
    for (const a of asignaciones) {
      const n = nombrePersona(a.docente.persona)
      cuenta.set(n, (cuenta.get(n) ?? 0) + 1)
    }
    docentePrincipal = [...cuenta.entries()].sort((x, y) => y[1] - x[1])[0][0]
  }

  return {
    institucion: {
      nombre: mayus(institucion?.nombre),
      rue: institucion?.rue ?? '',
      municipio: mayus(institucion?.municipio),
      distrito: mayus(institucion?.distrito),
      departamento: mayus(institucion?.departamento),
    },
    director: curso.gestion.director ? mayus(`${curso.gestion.director.persona.nombre} ${curso.gestion.director.persona.apellido}`) : '',
    gestion: { anio: curso.gestion.anio, notaMinimaAprobacion: Number(curso.gestion.notaMinimaAprobacion) },
    curso: {
      nivel: nivelEnTexto(curso.nivel),
      grado: gradoEnTexto(curso.grado),
      paralelo: curso.paralelo,
      turno: turnoEnTexto(curso.turno),
    },
    docentePrincipal,
    trimestre: { id: trimestre.id, numero: trimestre.numero, nombre: trimestre.nombre },
    trimestres: trimestresGestion,
    estudiantes,
    asistencia,
    areas,
    areasCompletas: soloDocenteId === undefined,
    horario,
  }
}


/**
 * Datos de TODA la gestión: uno por trimestre, en orden. Cada elemento es el mismo
 * DatosCuaderno de un trimestre (así se reutiliza todo el cálculo ya probado); el
 * constructor del libro los une en un solo Excel con los 3 trimestres y todos los meses.
 */
export async function obtenerDatosGestion(cursoId: number, soloDocenteId?: number): Promise<DatosCuaderno[]> {
  const curso = await prisma.curso.findUnique({ where: { id: cursoId }, select: { gestionId: true } })
  if (!curso) throw new NoEncontrado('Curso')
  const trimestres = await prisma.trimestre.findMany({
    where: { gestionId: curso.gestionId }, orderBy: { numero: 'asc' }, select: { id: true },
  })
  if (trimestres.length === 0) throw new NoEncontrado('Trimestres de la gestión')

  const datos: DatosCuaderno[] = []
  for (const t of trimestres) datos.push(await obtenerDatosCuaderno(cursoId, t.id, soloDocenteId))
  return datos
}
