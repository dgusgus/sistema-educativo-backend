// Historial académico de UN estudiante a lo largo de todas sus gestiones.
//
// Para qué: responder "¿qué nota tuvo en el 2.º trimestre de 2022?" sin entrar
// gestión por gestión, y servir de base al certificado de calificaciones que se
// entrega cuando un estudiante se traslada.

import { prisma } from '../lib/prisma.js'

export interface HistorialMateria {
  materia:     string
  codigo:      string
  campoSaber:  string | null
  // notas por id de trimestre (null = sin nota registrada)
  notas:       Record<number, number | null>
  promedioFinal: number | null
  resultado:   string
}

export interface HistorialGestion {
  gestionId:    number
  anio:         number
  inscripcionId: number
  curso:        { nivel: string; grado: number; paralelo: string; turno: string }
  estadoInscripcion: string
  resultado:    string
  notaMinima:   number
  trimestres:   { id: number; numero: number; nombre: string }[]
  materias:     HistorialMateria[]
  promedioPorTrimestre: Record<number, number | null>
  promedioAnual: number | null
  // % de asistencia por trimestre y general (null si no hay clases registradas)
  asistenciaPorTrimestre: Record<number, number | null>
  asistenciaGeneral: number | null
}

export interface HistorialEstudiante {
  estudiante: { id: number; nombre: string; apellido: string; ci: string | null; rude: string | null }
  gestiones:  HistorialGestion[]
}

const redondear = (n: number) => Math.round(n * 100) / 100
const promedio = (xs: number[]) => (xs.length ? redondear(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

export async function obtenerHistorialEstudiante(estudianteId: number): Promise<HistorialEstudiante | null> {
  const est = await prisma.estudiante.findUnique({
    where: { id: estudianteId },
    select: { id: true, rude: true, persona: { select: { nombre: true, apellido: true, ci: true } } },
  })
  if (!est) return null

  const inscripciones = await prisma.inscripcion.findMany({
    where: { estudianteId },
    orderBy: { gestion: { anio: 'asc' } },
    include: {
      gestion: { select: { id: true, anio: true, notaMinimaAprobacion: true } },
      curso:   { select: { nivel: true, grado: true, paralelo: true, turno: true } },
      calificaciones: {
        select: {
          promedioTrimestral: true, trimestreId: true, docenteMateriaCursoId: true,
          docenteMateriaCurso: {
            select: { materia: { select: { nombre: true, codigo: true, campoSaber: { select: { nombre: true, orden: true } } } } },
          },
        },
      },
      promediosFinales:   { select: { docenteMateriaCursoId: true, promedioFinal: true, resultado: true } },
      resumenAsistencias: { select: { trimestreId: true, totalClases: true, totalPresente: true, totalRetraso: true, totalJustificado: true } },
    },
  })

  const gestiones: HistorialGestion[] = []

  for (const ins of inscripciones) {
    const trimestres = await prisma.trimestre.findMany({
      where: { gestionId: ins.gestionId },
      orderBy: { numero: 'asc' },
      select: { id: true, numero: true, nombre: true },
    })

    // Materias de la inscripción (una por asignación, ordenadas por campo de saber y nombre)
    const mapa = new Map<number, HistorialMateria & { orden: number }>()
    const asegurar = (dmcId: number, m: { nombre: string; codigo: string; campoSaber: { nombre: string; orden: number } | null }) => {
      if (!mapa.has(dmcId)) {
        mapa.set(dmcId, {
          materia: m.nombre, codigo: m.codigo, campoSaber: m.campoSaber?.nombre ?? null,
          orden: m.campoSaber?.orden ?? Number.MAX_SAFE_INTEGER,
          notas: Object.fromEntries(trimestres.map(t => [t.id, null])),
          promedioFinal: null, resultado: 'PENDIENTE',
        })
      }
      return mapa.get(dmcId)!
    }
    // Todas las materias del curso aparecen aunque aún no tengan nota (se muestran con "—")
    const asignaciones = await prisma.docenteMateriaCurso.findMany({
      where: { cursoId: ins.cursoId, gestionId: ins.gestionId },
      select: { id: true, materia: { select: { nombre: true, codigo: true, campoSaber: { select: { nombre: true, orden: true } } } } },
    })
    for (const a of asignaciones) asegurar(a.id, a.materia)
    for (const c of ins.calificaciones) {
      const fila = asegurar(c.docenteMateriaCursoId, c.docenteMateriaCurso.materia)
      fila.notas[c.trimestreId] = c.promedioTrimestral === null ? null : Number(c.promedioTrimestral)
    }
    for (const p of ins.promediosFinales) {
      const fila = mapa.get(p.docenteMateriaCursoId)
      if (fila) { fila.promedioFinal = Number(p.promedioFinal); fila.resultado = p.resultado }
    }

    const materias = [...mapa.values()]
      .sort((a, b) => a.orden - b.orden || a.materia.localeCompare(b.materia, 'es'))
      .map(({ orden: _orden, ...m }) => m)

    const promedioPorTrimestre: Record<number, number | null> = {}
    for (const t of trimestres) {
      promedioPorTrimestre[t.id] = promedio(materias.map(m => m.notas[t.id]).filter((n): n is number => n !== null))
    }
    const promedioAnual = promedio(materias.map(m => m.promedioFinal).filter((n): n is number => n !== null))

    // Asistencia: presentes + retrasos + justificados sobre el total de clases
    const asistenciaPorTrimestre: Record<number, number | null> = {}
    let clasesTot = 0, okTot = 0
    for (const t of trimestres) {
      const filas = ins.resumenAsistencias.filter(r => r.trimestreId === t.id)
      const clases = filas.reduce((s, r) => s + r.totalClases, 0)
      const ok     = filas.reduce((s, r) => s + r.totalPresente + r.totalRetraso + r.totalJustificado, 0)
      asistenciaPorTrimestre[t.id] = clases ? redondear((ok / clases) * 100) : null
      clasesTot += clases; okTot += ok
    }

    gestiones.push({
      gestionId: ins.gestionId,
      anio: ins.gestion.anio,
      inscripcionId: ins.id,
      curso: { nivel: ins.curso.nivel, grado: ins.curso.grado, paralelo: ins.curso.paralelo, turno: ins.curso.turno },
      estadoInscripcion: ins.estadoInscripcion,
      resultado: ins.resultado,
      notaMinima: Number(ins.gestion.notaMinimaAprobacion),
      trimestres, materias, promedioPorTrimestre, promedioAnual,
      asistenciaPorTrimestre,
      asistenciaGeneral: clasesTot ? redondear((okTot / clasesTot) * 100) : null,
    })
  }

  return {
    estudiante: { id: est.id, nombre: est.persona.nombre, apellido: est.persona.apellido, ci: est.persona.ci, rude: est.rude },
    gestiones,
  }
}