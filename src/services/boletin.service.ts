// src/services/boletin.service.ts
//
// Boletín General de un curso: para cada estudiante inscrito, la nota
// de cada materia asignada al curso en cada trimestre, el promedio
// anual por materia (PromedioFinal) y el promedio general del
// estudiante (anual y por trimestre) promediando entre las materias
// que ya tienen nota cargada.
//
// No escribe nada — es puramente de lectura, arma el reporte a partir
// de Calificacion.promedioTrimestral y PromedioFinal.promedioFinal,
// que ya son calculados por recalcularCalificacion() y por el service
// de cierre de trimestre (pendiente, ver TODO en promedioFinal.service.ts).
//
// Equivale a la hoja "BOLETIN GENERAL" del registro pedagógico en
// papel: una fila por estudiante, una columna-grupo por materia
// (1erTrim/2doTrim/3erTrim/PromAnual), más 3 columnas de promedio
// general del estudiante.

import { prisma } from '../lib/prisma.js'

export interface BoletinGeneralMateria {
  docenteMateriaCursoId: number
  materiaId: number
  nombre: string
  codigo: string
  campoSaber: string | null
}

export interface BoletinGeneralNotaMateria {
  docenteMateriaCursoId: number
  notasPorTrimestre: Record<number, number | null> // trimestreId -> promedioTrimestral
  promedioAnual: number | null
  resultado: 'PENDIENTE' | 'PROMOVIDO' | 'REPROBADO'
}

export interface BoletinGeneralEstudiante {
  inscripcionId: number
  estudianteId: number
  rude: string | null
  nombreCompleto: string
  materias: BoletinGeneralNotaMateria[]
  promedioGeneralAnual: number | null
  promedioGeneralPorTrimestre: Record<number, number | null>
}

export interface BoletinGeneral {
  curso: {
    id: number
    nivel: string
    grado: number
    paralelo: string
    turno: string
    gestionId: number
    anioGestion: number
  }
  trimestres: { id: number; numero: number; nombre: string }[]
  materias: BoletinGeneralMateria[]
  estudiantes: BoletinGeneralEstudiante[]
}

export interface MejorEstudianteItem {
  puesto: number
  inscripcionId: number
  nombreCompleto: string
  promedio: number
}
 
export interface MejoresEstudiantesResponse {
  curso: BoletinGeneral['curso']
  trimestres: BoletinGeneral['trimestres']
  porTrimestre: Record<number, MejorEstudianteItem[]>
  anual: MejorEstudianteItem[]
}

export interface DetalleActividad {
  actividadEvaluativaId: number
  nombre: string
  nota: number | null
  puntajeMaximo: number
}
 
export interface DetalleDimension {
  dimensionId: number
  nombre: string
  promedio: number | null       // CalificacionDimension.promedio — el mismo que ya usa el resto del sistema
  actividades: DetalleActividad[]
}
 
export interface DetalleTrimestre {
  trimestreId: number
  numero: number
  nombre: string
  dimensiones: DetalleDimension[]
  total: number | null          // Calificacion.promedioTrimestral de esa materia en ese trimestre
}
 
export interface DetalleMateria {
  docenteMateriaCursoId: number
  nombre: string
  campoSaber: string | null
  trimestres: DetalleTrimestre[]
  promedioAnual: number | null  // PromedioFinal.promedioFinal
  resultado: 'PENDIENTE' | 'PROMOVIDO' | 'REPROBADO'
}
 
export interface DetalleBoletinEstudiante {
  inscripcionId: number
  estudianteId: number
  nombreCompleto: string
  curso: BoletinGeneral['curso']
  materias: DetalleMateria[]
}

// Redondea a `decimales` posiciones, o null si el valor es null/undefined.
function redondear(valor: number | null | undefined, decimales: number): number | null {
  if (valor === null || valor === undefined) return null
  const factor = 10 ** decimales
  return Math.round(valor * factor) / factor
}

// Promedia los valores no-nulos de un arreglo; null si no hay ninguno
// (una materia sin nota cargada NO cuenta como 0 en el promedio general,
// mismo criterio que recalcularCalificacion() usa para dimensiones).
function promediarNoNulos(valores: (number | null)[]): number | null {
  const cargados = valores.filter((v): v is number => v !== null)
  if (cargados.length === 0) return null
  return cargados.reduce((suma, v) => suma + v, 0) / cargados.length
}

export async function generarBoletinGeneral(cursoId: number): Promise<BoletinGeneral> {
  const curso = await prisma.curso.findUniqueOrThrow({
    where: { id: cursoId },
    select: { id: true, nivel: true, grado: true, paralelo: true, turno: true, gestionId: true, gestion: { select: { anio: true } } },
  })

  const [trimestres, asignaciones, inscripciones] = await Promise.all([
    prisma.trimestre.findMany({
      where: { gestionId: curso.gestionId },
      orderBy: { numero: 'asc' },
      select: { id: true, numero: true, nombre: true },
    }),
    prisma.docenteMateriaCurso.findMany({
      where: { cursoId },
      select: {
        id: true,
        materia: { select: { id: true, nombre: true, codigo: true, campoSaber: { select: { nombre: true, orden: true } } } },
      },
    }),
    prisma.inscripcion.findMany({
      where: { cursoId, estadoInscripcion: 'ACTIVA' },
      select: {
        id: true,
        estudianteId: true,
        estudiante: { select: { rude: true, persona: { select: { nombre: true, apellido: true } } } },
      },
      orderBy: { estudiante: { persona: { apellido: 'asc' } } },
    }),
  ])

  // Orden estable por campo de saber (los sin campo van al final) y luego por nombre.
  asignaciones.sort((a, b) => {
    const ordenA = a.materia.campoSaber?.orden ?? Number.MAX_SAFE_INTEGER
    const ordenB = b.materia.campoSaber?.orden ?? Number.MAX_SAFE_INTEGER
    if (ordenA !== ordenB) return ordenA - ordenB
    return a.materia.nombre.localeCompare(b.materia.nombre)
  })

  const dmcIds = asignaciones.map(a => a.id)
  const inscripcionIds = inscripciones.map(i => i.id)

  const [calificaciones, promediosFinales] = await Promise.all([
    dmcIds.length && inscripcionIds.length
      ? prisma.calificacion.findMany({
          where: { inscripcionId: { in: inscripcionIds }, docenteMateriaCursoId: { in: dmcIds } },
          select: { inscripcionId: true, docenteMateriaCursoId: true, trimestreId: true, promedioTrimestral: true },
        })
      : Promise.resolve([]),
    dmcIds.length && inscripcionIds.length
      ? prisma.promedioFinal.findMany({
          where: { inscripcionId: { in: inscripcionIds }, docenteMateriaCursoId: { in: dmcIds } },
          select: { inscripcionId: true, docenteMateriaCursoId: true, promedioFinal: true, resultado: true },
        })
      : Promise.resolve([]),
  ])

  // Índices rápidos: "inscripcionId-dmcId-trimestreId" -> nota, "inscripcionId-dmcId" -> promedio final.
  const notaPorTrimestre = new Map<string, number>()
  for (const c of calificaciones) {
    if (c.promedioTrimestral === null) continue
    notaPorTrimestre.set(`${c.inscripcionId}-${c.docenteMateriaCursoId}-${c.trimestreId}`, Number(c.promedioTrimestral))
  }
  const promedioFinalPorMateria = new Map<string, { promedio: number; resultado: string }>()
  for (const p of promediosFinales) {
    promedioFinalPorMateria.set(`${p.inscripcionId}-${p.docenteMateriaCursoId}`, {
      promedio: Number(p.promedioFinal),
      resultado: p.resultado,
    })
  }

  const materias: BoletinGeneralMateria[] = asignaciones.map(a => ({
    docenteMateriaCursoId: a.id,
    materiaId: a.materia.id,
    nombre: a.materia.nombre,
    codigo: a.materia.codigo,
    campoSaber: a.materia.campoSaber?.nombre ?? null,
  }))

  const estudiantes: BoletinGeneralEstudiante[] = inscripciones.map(insc => {
    const materiasDelEstudiante: BoletinGeneralNotaMateria[] = asignaciones.map(a => {
      const notasPorTrimestre: Record<number, number | null> = {}
      for (const t of trimestres) {
        notasPorTrimestre[t.id] = notaPorTrimestre.get(`${insc.id}-${a.id}-${t.id}`) ?? null
      }
      const final = promedioFinalPorMateria.get(`${insc.id}-${a.id}`)
      return {
        docenteMateriaCursoId: a.id,
        notasPorTrimestre,
        promedioAnual: final?.promedio ?? null,
        resultado: (final?.resultado ?? 'PENDIENTE') as BoletinGeneralNotaMateria['resultado'],
      }
    })

    const promedioGeneralPorTrimestre: Record<number, number | null> = {}
    for (const t of trimestres) {
      promedioGeneralPorTrimestre[t.id] = redondear(
        promediarNoNulos(materiasDelEstudiante.map(m => m.notasPorTrimestre[t.id])),
        2
      )
    }
    const promedioGeneralAnual = redondear(
      promediarNoNulos(materiasDelEstudiante.map(m => m.promedioAnual)),
      2
    )

    return {
      inscripcionId: insc.id,
      estudianteId: insc.estudianteId,
      rude: insc.estudiante.rude,
      nombreCompleto: `${insc.estudiante.persona.apellido} ${insc.estudiante.persona.nombre}`,
      materias: materiasDelEstudiante,
      promedioGeneralAnual,
      promedioGeneralPorTrimestre,
    }
  })

  return {
    curso: {
      id: curso.id,
      nivel: curso.nivel,
      grado: curso.grado,
      paralelo: curso.paralelo,
      turno: curso.turno,
      gestionId: curso.gestionId,
      anioGestion: curso.gestion.anio,
    },
    trimestres,
    materias,
    estudiantes,
  }
}


// Ranking por COMPETENCIA (1, 2, 2, 4 — dos empatados en 1° saltan el
// 2°, no lo reparten "a medias"). Corta por PUESTO, no por cantidad de
// filas: si el 3er puesto está empatado entre dos estudiantes, entran
// los dos aunque eso deje la lista con 4 filas para limite=3. Ignora a
// quien todavía no tiene promedio — no compite hasta tener nota.
function rankear(
  items: { inscripcionId: number; nombreCompleto: string; valor: number | null }[],
  limite: number
): MejorEstudianteItem[] {
  const conNota = items
    .filter((i): i is { inscripcionId: number; nombreCompleto: string; valor: number } => i.valor !== null)
    .sort((a, b) => b.valor - a.valor)
 
  const resultado: MejorEstudianteItem[] = []
  let puesto = 0
  let valorAnterior: number | null = null
 
  for (let i = 0; i < conNota.length; i++) {
    const item = conNota[i]
    if (item.valor !== valorAnterior) {
      puesto = i + 1
      valorAnterior = item.valor
    }
    if (puesto > limite) break
    resultado.push({ puesto, inscripcionId: item.inscripcionId, nombreCompleto: item.nombreCompleto, promedio: item.valor })
  }
  return resultado
}
 
// Mejores estudiantes del curso: uno por cada trimestre + uno con el
// promedio anual. Reutiliza generarBoletinGeneral() en vez de recalcular
// nada distinto — el ranking SIEMPRE coincide con lo que se ve en la
// tabla de pantalla, porque sale de los mismos números.
export async function obtenerMejoresEstudiantes(cursoId: number, limite = 3): Promise<MejoresEstudiantesResponse> {
  const boletin = await generarBoletinGeneral(cursoId)
 
  const porTrimestre: Record<number, MejorEstudianteItem[]> = {}
  for (const t of boletin.trimestres) {
    porTrimestre[t.id] = rankear(
      boletin.estudiantes.map(e => ({
        inscripcionId: e.inscripcionId,
        nombreCompleto: e.nombreCompleto,
        valor: e.promedioGeneralPorTrimestre[t.id],
      })),
      limite
    )
  }
 
  const anual = rankear(
    boletin.estudiantes.map(e => ({
      inscripcionId: e.inscripcionId,
      nombreCompleto: e.nombreCompleto,
      valor: e.promedioGeneralAnual,
    })),
    limite
  )
 
  return { curso: boletin.curso, trimestres: boletin.trimestres, porTrimestre, anual }
}


// Detalle completo de UN estudiante: cada actividad evaluativa dentro de
// cada dimensión, por cada materia y cada trimestre — a diferencia de
// generarBoletinGeneral() (que solo trae el promedio ya calculado), acá
// se baja hasta NotaActividad. Pensado para la tarjeta de detalle, no
// para la tabla del curso completo (sería demasiado pesado pedir esto
// por cada fila de 30 estudiantes a la vez).
export async function obtenerDetalleBoletinEstudiante(inscripcionId: number): Promise<DetalleBoletinEstudiante> {
  const inscripcion = await prisma.inscripcion.findUniqueOrThrow({
    where: { id: inscripcionId },
    select: {
      id: true,
      estudianteId: true,
      cursoId: true,
      gestionId: true,
      estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } },
      curso: { select: { nivel: true, grado: true, paralelo: true, turno: true, gestion: { select: { anio: true } } } },
    },
  })
 
  const [dimensiones, asignaciones, trimestres] = await Promise.all([
    prisma.dimensionEvaluacion.findMany({
      where: { gestionId: inscripcion.gestionId },
      orderBy: { orden: 'asc' },
      select: { id: true, nombre: true },
    }),
    prisma.docenteMateriaCurso.findMany({
      where: { cursoId: inscripcion.cursoId, gestionId: inscripcion.gestionId },
      select: {
        id: true,
        materia: { select: { nombre: true, campoSaber: { select: { nombre: true, orden: true } } } },
      },
    }),
    prisma.trimestre.findMany({
      where: { gestionId: inscripcion.gestionId },
      orderBy: { numero: 'asc' },
      select: { id: true, numero: true, nombre: true },
    }),
  ])
 
  asignaciones.sort((a, b) => {
    const oa = a.materia.campoSaber?.orden ?? Number.MAX_SAFE_INTEGER
    const ob = b.materia.campoSaber?.orden ?? Number.MAX_SAFE_INTEGER
    return oa !== ob ? oa - ob : a.materia.nombre.localeCompare(b.materia.nombre)
  })
 
  const dmcIds = asignaciones.map(a => a.id)
  const trimestreIds = trimestres.map(t => t.id)
 
  const [actividades, calificaciones, promediosFinales] = await Promise.all([
    prisma.actividadEvaluativa.findMany({
      where: { docenteMateriaCursoId: { in: dmcIds }, trimestreId: { in: trimestreIds }, activo: true },
      select: {
        id: true, nombre: true, puntajeMaximo: true, docenteMateriaCursoId: true, trimestreId: true, dimensionId: true,
        notas: { where: { inscripcionId }, select: { nota: true } },
      },
      orderBy: { fecha: 'asc' },
    }),
    prisma.calificacion.findMany({
      where: { inscripcionId, docenteMateriaCursoId: { in: dmcIds }, trimestreId: { in: trimestreIds } },
      select: {
        docenteMateriaCursoId: true, trimestreId: true, promedioTrimestral: true,
        dimensiones: { select: { dimensionId: true, promedio: true } },
      },
    }),
    prisma.promedioFinal.findMany({
      where: { inscripcionId, docenteMateriaCursoId: { in: dmcIds } },
      select: { docenteMateriaCursoId: true, promedioFinal: true, resultado: true },
    }),
  ])
 
  const materias: DetalleMateria[] = asignaciones.map(dmc => {
    const trimestresMateria: DetalleTrimestre[] = trimestres.map(t => {
      const cal = calificaciones.find(c => c.docenteMateriaCursoId === dmc.id && c.trimestreId === t.id)
 
      const dimensionesMateria: DetalleDimension[] = dimensiones.map(dim => {
        const actividadesDim = actividades.filter(
          a => a.docenteMateriaCursoId === dmc.id && a.trimestreId === t.id && a.dimensionId === dim.id
        )
        const calDim = cal?.dimensiones.find(cd => cd.dimensionId === dim.id)
        return {
          dimensionId: dim.id,
          nombre: dim.nombre,
          promedio: calDim ? Number(calDim.promedio) : null,
          actividades: actividadesDim.map(a => ({
            actividadEvaluativaId: a.id,
            nombre: a.nombre,
            nota: a.notas[0] ? Number(a.notas[0].nota) : null,
            puntajeMaximo: Number(a.puntajeMaximo),
          })),
        }
      })
 
      return {
        trimestreId: t.id,
        numero: t.numero,
        nombre: t.nombre,
        dimensiones: dimensionesMateria,
        total: cal?.promedioTrimestral !== undefined && cal?.promedioTrimestral !== null ? Number(cal.promedioTrimestral) : null,
      }
    })
 
    const final = promediosFinales.find(p => p.docenteMateriaCursoId === dmc.id)
 
    return {
      docenteMateriaCursoId: dmc.id,
      nombre: dmc.materia.nombre,
      campoSaber: dmc.materia.campoSaber?.nombre ?? null,
      trimestres: trimestresMateria,
      promedioAnual: final ? Number(final.promedioFinal) : null,
      resultado: (final?.resultado ?? 'PENDIENTE'),
    }
  })
 
  return {
    inscripcionId: inscripcion.id,
    estudianteId: inscripcion.estudianteId,
    nombreCompleto: `${inscripcion.estudiante.persona.apellido} ${inscripcion.estudiante.persona.nombre}`,
    curso: {
      id: inscripcion.cursoId,
      nivel: inscripcion.curso.nivel as any,
      grado: inscripcion.curso.grado,
      paralelo: inscripcion.curso.paralelo,
      turno: inscripcion.curso.turno as any,
      gestionId: inscripcion.gestionId,
      anioGestion: inscripcion.curso.gestion.anio,
    },
    materias,
  }
}