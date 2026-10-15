// src/lib/excel/cuaderno.builder.ts
//
// Dibuja el cuaderno pedagógico en un libro Excel. NO calcula nada: recibe los datos
// ya listos de services/cuaderno.service.ts y los coloca en la misma estructura que
// el cuaderno de papel (carátula, filiación, registro de valoración por área).
//
// Todo son VALORES, no fórmulas: el sistema es la única fuente de los números.
// Las filas crecen según la cantidad de estudiantes (el Excel original estaba
// limitado a 15) y las columnas según las actividades que el docente creó.

import ExcelJS from 'exceljs'
import type { AreaCuaderno, DatosCuaderno, MesAsistencia } from '../../services/cuaderno.service.js'
import type { LetraAsistencia } from '../cuaderno.asistencia.js'
import { calcularGenerales, rankear, type PromediosGenerales } from '../cuaderno.boletin.js'
import {
  BORDES, COLOR, COLORES_DIMENSION, bordear, configurarImpresion, fusionar, nombreHoja, poner, rellenar,
} from './estilos.js'

const ORDINAL_TRIMESTRE = ['', '1er', '2do', '3er']
const etiquetaTrimestre = (n: number) => ORDINAL_TRIMESTRE[n] ?? `${n}º`

// Puntaje sin ceros inútiles: 10 → "10", 7.5 → "7.5"
const puntos = (n: number) => String(Number(n.toFixed(2)))

/** Cuaderno de UN trimestre (lo que ya se descargaba). */
export async function construirCuaderno(datos: DatosCuaderno): Promise<Buffer> {
  return construirLibro([datos], false)
}

/**
 * Cuaderno de TODA la gestión: un solo libro con los trimestres juntos.
 * `porTrimestre` trae un DatosCuaderno por trimestre, en orden.
 *  - Asistencia: todos los meses del año (un mes partido entre dos trimestres se une en una hoja).
 *  - Por cada área: un centralizador y una hoja de valoración por trimestre (MAT 1 TRIM, MAT 2 TRIM…).
 *  - Entrevista a padres: una ficha por trimestre.
 */
export async function construirCuadernoGestion(porTrimestre: DatosCuaderno[]): Promise<Buffer> {
  if (porTrimestre.length === 0) throw new Error('construirCuadernoGestion: no hay trimestres')
  return construirLibro(porTrimestre, true)
}

/** Une los meses que aparecen en más de un trimestre (p. ej. un trimestre que termina a mitad de mes). */
function unirMeses(meses: MesAsistencia[]): MesAsistencia[] {
  const porClave = new Map<string, MesAsistencia>()
  for (const m of meses) {
    const clave = `${m.anio}-${m.mes}`
    const previo = porClave.get(clave)
    if (!previo) { porClave.set(clave, { ...m, dias: [...m.dias], diasConRegistro: [...m.diasConRegistro], filas: m.filas.map(f => ({ ...f, estados: { ...f.estados }, totales: { ...f.totales } })) }); continue }
    previo.dias = [...previo.dias, ...m.dias].sort((a, b) => a.fecha.localeCompare(b.fecha))
    previo.diasConRegistro = [...new Set([...previo.diasConRegistro, ...m.diasConRegistro])].sort()
    for (const f of m.filas) {
      const destino = previo.filas.find(x => x.inscripcionId === f.inscripcionId)
      if (!destino) { previo.filas.push({ ...f, estados: { ...f.estados }, totales: { ...f.totales } }); continue }
      Object.assign(destino.estados, f.estados)
      for (const l of LETRAS) destino.totales[l] = (destino.totales[l] ?? 0) + (f.totales[l] ?? 0)
    }
  }
  return [...porClave.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes)
}

async function construirLibro(porTrimestre: DatosCuaderno[], gestionCompleta: boolean): Promise<Buffer> {
  // Los datos del curso, estudiantes y centralizadores son iguales en todos los trimestres;
  // se toma el último para que "trimestres" y los promedios anuales estén lo más completos posible.
  const datos = porTrimestre[porTrimestre.length - 1]
  const libro = new ExcelJS.Workbook()
  libro.creator = 'Sistema Web de Gestión Académica'
  libro.created = new Date()

  const usados = new Set<string>()
  hojaCaratula(libro, datos, nombreHoja('CARATULA', usados))
  hojaFiliacion(libro, datos, nombreHoja('FILIA', usados))
  hojaHorario(libro, datos, nombreHoja('HORARIO', usados))
  hojaRegistroPadres(libro, datos, nombreHoja('REGISTRO PPFF', usados))
  for (const t of porTrimestre) {
    hojaEntrevista(libro, t, nombreHoja(gestionCompleta ? `ENTREVISTA PPFF ${t.trimestre.numero}T` : 'ENTREVISTA PPFF', usados))
  }
  const meses = gestionCompleta ? unirMeses(porTrimestre.flatMap(t => t.asistencia)) : datos.asistencia
  for (const mes of meses) {
    hojaAsistencia(libro, datos, mes, nombreHoja(mes.abreviatura, usados), gestionCompleta)
  }
  for (const area of datos.areas) {
    hojaCentralizador(libro, datos, area, nombreHoja(`CENTRA ${area.codigo}`, usados))
    for (const t of porTrimestre) {
      const delTrimestre = t.areas.find(a => a.docenteMateriaCursoId === area.docenteMateriaCursoId)
      if (delTrimestre) hojaValoracion(libro, t, delTrimestre, nombreHoja(`${area.codigo} ${t.trimestre.numero} TRIM`, usados))
    }
  }

  // Las hojas del curso completo solo tienen sentido con TODAS las áreas (un docente que ve
  // solo las suyas obtendría promedios generales falsos), por eso se omiten en ese caso.
  if (datos.areasCompletas && datos.areas.length > 0 && datos.estudiantes.length > 0) {
    const generales = calcularGenerales(datos)
    hojaBoletinGeneral(libro, datos, generales, nombreHoja('BOLETIN GENERAL', usados))
    hojaMejores(libro, datos, generales, nombreHoja('MEJORES EST', usados))
    hojaLibretas(libro, datos, generales, nombreHoja('LIBRETAS', usados))
  }

  return Buffer.from(await libro.xlsx.writeBuffer())
}

// ─── CARÁTULA ────────────────────────────────────────────────────────────────

function hojaCaratula(libro: ExcelJS.Workbook, d: DatosCuaderno, nombre: string): void {
  const h = libro.addWorksheet(nombre)
  h.columns = [{ width: 4 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 4 }]
  configurarImpresion(h, { vertical: true })

  // Marco azul de la portada
  for (let f = 2; f <= 26; f++) for (let c = 1; c <= 7; c++) {
    if (f === 2 || f === 26 || c === 1 || c === 7) rellenar(h.getCell(f, c), COLOR.azulOscuro)
  }

  const linea = (fila: number, texto: string, tamano: number, negrita = true, color: string = COLOR.azulOscuro) => {
    fusionar(h, fila, 2, fila, 6)
    poner(h, fila, 2, texto, { tamano, negrita, color, alineacion: 'center' })
  }

  h.getRow(4).height = 36
  linea(4, 'CUADERNO PEDAGÓGICO', 26)
  linea(5, `GESTIÓN ${d.gestion.anio}`, 18, true, COLOR.azulMedio)

  const bloque = (fila: number, etiqueta: string, valor: string) => {
    fusionar(h, fila, 2, fila, 6)
    poner(h, fila, 2, etiqueta, { tamano: 10, negrita: true, color: COLOR.grisMedio })
    fusionar(h, fila + 1, 2, fila + 1, 6)
    poner(h, fila + 1, 2, valor || '—', { tamano: 15, negrita: true })
    h.getRow(fila + 1).height = 24
  }

  bloque(8,  'DISTRITO / MUNICIPIO', d.institucion.municipio)
  bloque(10, 'UNIDAD EDUCATIVA', d.institucion.nombre)
  bloque(12, 'CÓDIGO SIE', d.institucion.rue)
  bloque(14, 'NIVEL', d.curso.nivel)
  bloque(16, 'CURSO', `${d.curso.grado}  "${d.curso.paralelo}"`)
  bloque(18, 'PROFESOR(A)', d.docentePrincipal)
  bloque(20, 'TURNO', d.curso.turno)

  const lugar = [d.institucion.municipio, d.institucion.departamento, 'BOLIVIA'].filter(Boolean).join(' - ')
  linea(24, lugar, 12, true, COLOR.azulMedio)
}

// ─── FILIACIÓN ───────────────────────────────────────────────────────────────

function hojaFiliacion(libro: ExcelJS.Workbook, d: DatosCuaderno, nombre: string): void {
  const h = libro.addWorksheet(nombre)
  h.columns = [
    { width: 5 }, { width: 16 }, { width: 24 }, { width: 24 }, { width: 16 },
    { width: 26 }, { width: 20 }, { width: 26 }, { width: 20 },
  ]
  configurarImpresion(h, { filasRepetidas: '6:7' })
  const ULT = 9

  fusionar(h, 1, 1, 1, ULT)
  poner(h, 1, 1, `FILIACIÓN DE ESTUDIANTES - GESTIÓN ${d.gestion.anio}`, { tamano: 14, negrita: true, color: COLOR.azulOscuro })
  h.getRow(1).height = 26

  const dato = (fila: number, col: number, texto: string, hasta: number) => {
    fusionar(h, fila, col, fila, hasta)
    poner(h, fila, col, texto, { alineacion: 'left', negrita: true })
  }
  dato(2, 1, `PROFESOR(A): ${d.docentePrincipal}`, 4)
  dato(2, 5, `NIVEL: ${d.curso.nivel}`, ULT)
  dato(3, 1, `CÓDIGO SIE: ${d.institucion.rue}`, 4)
  dato(3, 5, `CURSO: ${d.curso.grado}`, ULT)
  dato(4, 1, `UNIDAD EDUCATIVA: ${d.institucion.nombre}`, 4)
  dato(4, 5, `PARALELO: ${d.curso.paralelo}`, ULT)

  // Encabezado en dos filas: grupos (madre / padre) y columnas
  fusionar(h, 6, 6, 6, 7)
  poner(h, 6, 6, 'DATOS DE LA MADRE', { negrita: true, color: COLOR.blanco, fondo: COLOR.azulMedio, borde: true })
  fusionar(h, 6, 8, 6, 9)
  poner(h, 6, 8, 'DATOS DEL PADRE O TUTOR', { negrita: true, color: COLOR.blanco, fondo: COLOR.azulMedio, borde: true })
  bordear(h, 6, 6, 6, 9)

  const cabeceras = ['N°', 'RUDE', 'APELLIDOS', 'NOMBRES', 'TELÉFONO / CELULAR', 'NOMBRE', 'OCUPACIÓN', 'NOMBRE', 'OCUPACIÓN']
  // Filas 6 y 7: las columnas sin grupo ocupan ambas filas; madre/padre tienen el grupo arriba y la columna abajo
  for (let c = 1; c <= 5; c++) fusionar(h, 6, c, 7, c)
  cabeceras.forEach((t, i) => {
    const c = i + 1
    poner(h, c <= 5 ? 6 : 7, c, t, { negrita: true, color: COLOR.blanco, fondo: COLOR.azulOscuro, borde: true })
  })
  bordear(h, 6, 1, 7, ULT)
  h.getRow(6).height = 20
  h.getRow(7).height = 20

  d.estudiantes.forEach((e, i) => {
    const fila = 8 + i
    const zebra = i % 2 === 1 ? COLOR.azulClaro : undefined
    const celda = (col: number, valor: string | number, alineacion: 'left' | 'center' = 'left') =>
      poner(h, fila, col, valor, { alineacion, borde: true, fondo: zebra, ajustar: false })
    celda(1, e.numero, 'center')
    celda(2, e.rude, 'center').numFmt = '@'     // el RUDE es texto: no perder ceros ni usar notación científica
    celda(3, e.apellidos)
    celda(4, e.nombres)
    celda(5, e.telefono, 'center')
    celda(6, e.madre?.nombre ?? '')
    celda(7, e.madre?.ocupacion ?? '')
    celda(8, e.padre?.nombre ?? '')
    celda(9, e.padre?.ocupacion ?? '')
  })

  h.views = [{ showGridLines: false, state: 'frozen', ySplit: 7 }]
}

// ─── ASISTENCIA MENSUAL (una hoja por mes del trimestre) ─────────────────────

const COLOR_LETRA: Record<LetraAsistencia, string> = { A: COLOR.verde, F: COLOR.rojo, R: 'B7791F', L: COLOR.azulMedio }
const LETRAS: LetraAsistencia[] = ['A', 'F', 'R', 'L']

function hojaAsistencia(libro: ExcelJS.Workbook, d: DatosCuaderno, mes: MesAsistencia, nombre: string, gestionCompleta = false): void {
  const h = libro.addWorksheet(nombre)
  const nDias = mes.dias.length
  const colPrimerDia = 3
  const colUltimoDia = colPrimerDia + nDias - 1
  const colTotales = colPrimerDia + nDias            // A, F, R, L en las 4 columnas siguientes
  const ULT = colTotales + LETRAS.length - 1

  h.getColumn(1).width = 5
  h.getColumn(2).width = 40
  for (let c = colPrimerDia; c <= colUltimoDia; c++) h.getColumn(c).width = 4.3
  for (let c = colTotales; c <= ULT; c++) h.getColumn(c).width = 5.5
  configurarImpresion(h, { filasRepetidas: '6:8' })

  fusionar(h, 1, 1, 1, ULT)
  poner(h, 1, 1, gestionCompleta ? `ASISTENCIA - GESTIÓN ${d.gestion.anio}` : `ASISTENCIA ${d.trimestre.nombre.toUpperCase()} - GESTIÓN ${d.gestion.anio}`, {
    tamano: 14, negrita: true, color: COLOR.azulOscuro,
  })
  h.getRow(1).height = 26

  // Datos del curso: mitad izquierda y mitad derecha (el ancho depende de cuántos días tenga el mes)
  const medio = Math.max(4, Math.floor(ULT / 2))
  const dato = (fila: number, izquierda: boolean, texto: string) => {
    const desde = izquierda ? 1 : medio + 1
    const hasta = izquierda ? medio : ULT
    fusionar(h, fila, desde, fila, hasta)
    poner(h, fila, desde, texto, { alineacion: 'left', negrita: true, ajustar: false })
  }
  dato(2, true, `PROFESOR(A): ${d.docentePrincipal}`)
  dato(2, false, `NIVEL: ${d.curso.nivel}`)
  dato(3, true, `CÓDIGO SIE: ${d.institucion.rue}`)
  dato(3, false, `GRADO: ${d.curso.grado}`)
  dato(4, true, `UNIDAD EDUCATIVA: ${d.institucion.nombre}`)
  dato(4, false, `PARALELO: ${d.curso.paralelo}`)
  fusionar(h, 5, 1, 5, ULT)
  poner(h, 5, 1, 'A = Asistencia     F = Faltas     R = Retrasos     L = Licencias', {
    alineacion: 'left', color: COLOR.grisMedio, tamano: 9, ajustar: false,
  })

  // ── Encabezado: Nº | nombre | [mes: letra y número de cada día] | totales ──
  const FILA_MES = 6, FILA_LETRA = 7, FILA_DIA = 8, PRIMERA = 9
  const cab = { negrita: true, color: COLOR.blanco, borde: true } as const

  fusionar(h, FILA_MES, 1, FILA_DIA, 1)
  poner(h, FILA_MES, 1, 'N°', { ...cab, fondo: COLOR.azulOscuro })
  fusionar(h, FILA_MES, 2, FILA_DIA, 2)
  poner(h, FILA_MES, 2, 'APELLIDOS Y NOMBRES', { ...cab, fondo: COLOR.azulOscuro })
  bordear(h, FILA_MES, 1, FILA_DIA, 2)

  // Si el mes tiene registros, los días sin lista (feriados, sin clase) se sombrean
  const hayRegistros = mes.diasConRegistro.length > 0
  const sinLista = new Set(hayRegistros ? mes.dias.filter(x => !mes.diasConRegistro.includes(x.fecha)).map(x => x.fecha) : [])

  if (nDias > 0) {
    fusionar(h, FILA_MES, colPrimerDia, FILA_MES, colUltimoDia)
    poner(h, FILA_MES, colPrimerDia, `MES: ${mes.nombre}${mes.anio !== d.gestion.anio ? ` ${mes.anio}` : ''}`, { ...cab, fondo: COLOR.azulMedio })
    bordear(h, FILA_MES, colPrimerDia, FILA_MES, colUltimoDia)
  }
  mes.dias.forEach((dia, i) => {
    const c = colPrimerDia + i
    const fondo = sinLista.has(dia.fecha) ? COLOR.grisMedio : COLOR.azulOscuro
    poner(h, FILA_LETRA, c, dia.letra, { ...cab, fondo, tamano: 9 })
    poner(h, FILA_DIA, c, dia.dia, { ...cab, fondo, tamano: 9 })
  })
  LETRAS.forEach((letra, i) => {
    const c = colTotales + i
    fusionar(h, FILA_MES, c, FILA_DIA, c)
    poner(h, FILA_MES, c, letra, { ...cab, fondo: COLOR_LETRA[letra], tamano: 11 })
    bordear(h, FILA_MES, c, FILA_DIA, c)
  })
  h.getRow(FILA_MES).height = 20

  // ── Filas de estudiantes ────────────────────────────────────────────────────
  d.estudiantes.forEach((est, i) => {
    const fila = PRIMERA + i
    const zebra = i % 2 === 1 ? COLOR.azulClaro : undefined
    const datos = mes.filas.find(f => f.inscripcionId === est.inscripcionId)
    const base = { borde: true, ajustar: false } as const

    poner(h, fila, 1, est.numero, { ...base, fondo: zebra })
    poner(h, fila, 2, est.nombreCompleto, { ...base, fondo: zebra, alineacion: 'left' })

    mes.dias.forEach((dia, k) => {
      const letra = datos?.estados[dia.fecha] ?? null
      poner(h, fila, colPrimerDia + k, letra, {
        ...base, negrita: true, tamano: 9,
        fondo: sinLista.has(dia.fecha) ? COLOR.grisClaro : zebra,
        color: letra ? COLOR_LETRA[letra] : undefined,
      })
    })
    LETRAS.forEach((letra, k) => {
      const n = datos?.totales[letra] ?? 0
      poner(h, fila, colTotales + k, n > 0 ? n : null, { ...base, negrita: true, fondo: zebra, color: COLOR_LETRA[letra] })
    })
  })

  const ultima = PRIMERA + Math.max(d.estudiantes.length, 1) - 1
  const filaFirma = ultima + 3
  fusionar(h, filaFirma, 2, filaFirma, 2)
  poner(h, filaFirma, 2, '______________________________', { alineacion: 'center' })
  poner(h, filaFirma + 1, 2, 'FIRMA / SELLO', { negrita: true, color: COLOR.grisMedio })

  h.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: FILA_DIA }]
}

// ─── CENTRALIZADOR POR ÁREA (notas de todos los trimestres + promedio anual) ──

function hojaCentralizador(libro: ExcelJS.Workbook, d: DatosCuaderno, area: AreaCuaderno, nombre: string): void {
  const h = libro.addWorksheet(nombre)
  const nTrim = d.trimestres.length
  const colAnual = 3 + nTrim
  const colObs = colAnual + 1
  const ULT = colObs

  h.getColumn(1).width = 5
  h.getColumn(2).width = 40
  for (let c = 3; c < colAnual; c++) h.getColumn(c).width = 14
  h.getColumn(colAnual).width = 14
  h.getColumn(colObs).width = 17

  const FILA_CAB = 9
  const PRIMERA = 10
  configurarImpresion(h, { vertical: true, filasRepetidas: `${FILA_CAB}:${FILA_CAB}` })

  fusionar(h, 1, 1, 1, ULT)
  poner(h, 1, 1, `CENTRALIZADOR ${area.materia}`, { tamano: 14, negrita: true, color: COLOR.azulOscuro })
  h.getRow(1).height = 26
  fusionar(h, 2, 1, 2, ULT)
  poner(h, 2, 1, `${d.curso.grado} ${d.curso.paralelo}`, { tamano: 11, negrita: true, color: COLOR.azulMedio })

  const datos: Array<[string, string]> = [
    ['Unidad Educativa:', d.institucion.nombre],
    ['Profesor(a):', area.docente],
    ['Materia:', area.materia],
    ['Gestión:', String(d.gestion.anio)],
  ]
  datos.forEach(([etiqueta, valor], i) => {
    const fila = 4 + i
    poner(h, fila, 2, etiqueta, { alineacion: 'right', negrita: true, color: COLOR.grisMedio })
    fusionar(h, fila, 3, fila, ULT)
    poner(h, fila, 3, valor, { alineacion: 'left', negrita: true, ajustar: false })
  })

  // ── Encabezado ──
  const cab = { negrita: true, color: COLOR.blanco, borde: true } as const
  poner(h, FILA_CAB, 1, 'Nº', { ...cab, fondo: COLOR.azulOscuro })
  poner(h, FILA_CAB, 2, 'APELLIDOS Y NOMBRES', { ...cab, fondo: COLOR.azulOscuro })
  d.trimestres.forEach((t, i) => {
    poner(h, FILA_CAB, 3 + i, `Prom. ${etiquetaTrimestre(t.numero)} Trim.`, { ...cab, fondo: COLOR.azulMedio })
  })
  poner(h, FILA_CAB, colAnual, 'Promedio Anual', { ...cab, fondo: COLOR.azulOscuro })
  poner(h, FILA_CAB, colObs, 'OBSERVACIÓN', { ...cab, fondo: COLOR.azulOscuro })
  h.getRow(FILA_CAB).height = 30

  // ── Filas ──
  const minimo = d.gestion.notaMinimaAprobacion
  d.estudiantes.forEach((est, i) => {
    const fila = PRIMERA + i
    const datosFila = area.centralizador.filas.find(f => f.inscripcionId === est.inscripcionId)
    const zebra = i % 2 === 1 ? COLOR.azulClaro : undefined
    const base = { borde: true, fondo: zebra, ajustar: false } as const

    poner(h, fila, 1, est.numero, base)
    poner(h, fila, 2, est.nombreCompleto, { ...base, alineacion: 'left' })
    d.trimestres.forEach((t, k) => {
      const nota = datosFila?.porTrimestre[t.id] ?? null
      poner(h, fila, 3 + k, nota, { ...base, color: nota !== null && nota < minimo ? COLOR.rojo : undefined })
    })
    const reprobado = datosFila?.resultado === 'RETENIDO'
    poner(h, fila, colAnual, datosFila?.promedioAnual ?? null, {
      ...base, negrita: true, tamano: 11, color: reprobado ? COLOR.rojo : COLOR.azulOscuro,
    })
    poner(h, fila, colObs, datosFila?.resultado ?? null, {
      ...base, negrita: true, tamano: 9, color: reprobado ? COLOR.rojo : COLOR.verde,
    })
  })

  // ── Pie con estadísticas (sobre el promedio anual) ──
  const r = area.centralizador.resumen
  const ultima = PRIMERA + Math.max(d.estudiantes.length, 1) - 1
  const lineas: Array<[string, number | null, string?]> = [
    ['TOTAL DE ESTUDIANTES', r.totalEstudiantes],
    ['TOTAL APROBADOS', r.aprobados],
    ['TOTAL REPROBADOS', r.reprobados],
    ['PROMEDIO ANUAL', r.promedio],
    ['PORCENTAJE DE APROBADOS', r.porcentajeAprobados, '0.0"%"'],
    ['PORCENTAJE DE REPROBADOS', r.porcentajeReprobados, '0.0"%"'],
  ]
  const colEtiqueta = Math.max(2, colAnual - 2)
  lineas.forEach(([etiqueta, valor, formato], i) => {
    const fila = ultima + 2 + i
    fusionar(h, fila, colEtiqueta, fila, colAnual - 1)
    poner(h, fila, colEtiqueta, etiqueta, { alineacion: 'right', negrita: true, borde: true, fondo: COLOR.azulClaro })
    bordear(h, fila, colEtiqueta, fila, colAnual - 1)
    poner(h, fila, colAnual, valor, { negrita: true, borde: true, formato })
  })

  const filaFirma = ultima + 4 + lineas.length
  poner(h, filaFirma, 2, '______________________________', { alineacion: 'center' })
  poner(h, filaFirma + 1, 2, 'FIRMA / SELLO', { negrita: true, color: COLOR.grisMedio })

  h.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: FILA_CAB }]
}

// ─── REGISTRO DE VALORACIÓN CUANTITATIVA (una hoja por área) ─────────────────

interface GrupoDimension {
  nombre: string
  puntajeMaximo: number
  dimensionId: number
  colorHex: string
  colInicio: number
  colPromedio: number
  actividades: AreaCuaderno['dimensiones'][number]['actividades']
}

function hojaValoracion(libro: ExcelJS.Workbook, d: DatosCuaderno, area: AreaCuaderno, nombre: string): void {
  const h = libro.addWorksheet(nombre)

  // ── Plano de columnas: Nº | Nombre | [actividades + promedio] por dimensión | desarrollo | autoevaluación | total
  const evaluadas = area.dimensiones.filter(x => !x.esAutoevaluada)
  const autoevaluadas = area.dimensiones.filter(x => x.esAutoevaluada)

  let col = 3
  const grupos: GrupoDimension[] = evaluadas.map((dim, i) => {
    const g: GrupoDimension = {
      nombre: dim.nombre, puntajeMaximo: dim.puntajeMaximo, dimensionId: dim.dimensionId,
      colorHex: COLORES_DIMENSION[i % COLORES_DIMENSION.length],
      colInicio: col, colPromedio: col + dim.actividades.length, actividades: dim.actividades,
    }
    col = g.colPromedio + 1
    return g
  })
  const colDesarrollo = col++
  const colAuto = autoevaluadas.length > 0 ? col++ : null
  const colTotal = col++
  const ULT = colTotal

  h.getColumn(1).width = 5
  h.getColumn(2).width = 40
  for (let c = 3; c <= ULT; c++) h.getColumn(c).width = 8.5
  for (const g of grupos) h.getColumn(g.colPromedio).width = 11
  h.getColumn(colDesarrollo).width = 14
  if (colAuto) h.getColumn(colAuto).width = 17
  h.getColumn(colTotal).width = 12

  const FILA_GRUPO = 10
  const FILA_PUNTOS = 11
  const FILA_ACT = 12
  const PRIMERA = 13
  configurarImpresion(h, { filasRepetidas: `${FILA_GRUPO}:${FILA_ACT}` })

  // ── Título y datos del curso ────────────────────────────────────────────────
  fusionar(h, 1, 1, 1, ULT)
  poner(h, 1, 1, 'REGISTRO DE VALORACIÓN CUANTITATIVA', { tamano: 14, negrita: true, color: COLOR.azulOscuro })
  h.getRow(1).height = 26

  const datosCurso: Array<[string, string]> = [
    ['Prof(a):', area.docente],
    ['Campo:', area.campoSaber || '—'],
    ['Área:', area.materia],
    ['Curso:', `${d.curso.grado} ${d.curso.paralelo}`],
    ['Nivel:', d.curso.nivel],
    ['Trimestre:', d.trimestre.nombre.toUpperCase()],
    ['Gestión:', String(d.gestion.anio)],
  ]
  const finDato = Math.min(ULT, 8)
  datosCurso.forEach(([etiqueta, valor], i) => {
    const fila = 2 + i
    poner(h, fila, 2, etiqueta, { alineacion: 'right', negrita: true, color: COLOR.grisMedio })
    fusionar(h, fila, 3, fila, finDato)
    poner(h, fila, 3, valor, { alineacion: 'left', negrita: true, ajustar: false })
  })

  // ── Encabezado de la tabla ──────────────────────────────────────────────────
  const cabecera = { negrita: true, color: COLOR.blanco, borde: true } as const

  fusionar(h, FILA_GRUPO, 1, FILA_ACT, 1)
  poner(h, FILA_GRUPO, 1, 'Nº', { ...cabecera, fondo: COLOR.azulOscuro })
  fusionar(h, FILA_GRUPO, 2, FILA_ACT, 2)
  poner(h, FILA_GRUPO, 2, 'APELLIDOS Y NOMBRES', { ...cabecera, fondo: COLOR.azulOscuro })

  for (const g of grupos) {
    fusionar(h, FILA_GRUPO, g.colInicio, FILA_GRUPO, g.colPromedio)
    poner(h, FILA_GRUPO, g.colInicio, g.nombre.toUpperCase(), { ...cabecera, fondo: g.colorHex })
    fusionar(h, FILA_PUNTOS, g.colInicio, FILA_PUNTOS, g.colPromedio)
    poner(h, FILA_PUNTOS, g.colInicio, `VALORACIÓN ${puntos(g.puntajeMaximo)} Pts`, { ...cabecera, fondo: g.colorHex })
    g.actividades.forEach((act, i) => {
      // Nombre de la actividad en vertical para que 8 actividades quepan en una hoja
      poner(h, FILA_ACT, g.colInicio + i, `${act.nombre} (${puntos(act.puntajeMaximo)})`, {
        rotar: 90, negrita: true, borde: true, fondo: COLOR.azulClaro, tamano: 9,
      })
    })
    poner(h, FILA_ACT, g.colPromedio, 'PROMEDIO', { ...cabecera, fondo: g.colorHex, tamano: 9 })
    bordear(h, FILA_GRUPO, g.colInicio, FILA_ACT, g.colPromedio)
  }

  const columnaSimple = (c: number, texto: string, hex: string) => {
    fusionar(h, FILA_GRUPO, c, FILA_ACT, c)
    poner(h, FILA_GRUPO, c, texto, { ...cabecera, fondo: hex })
    bordear(h, FILA_GRUPO, c, FILA_ACT, c)
  }
  columnaSimple(colDesarrollo, 'PROMEDIO DESARROLLO CURRICULAR', COLOR.azulMedio)
  if (colAuto) {
    const ptsAuto = autoevaluadas.reduce((s, x) => s + x.puntajeMaximo, 0)
    columnaSimple(colAuto, `AUTOEVALUACIÓN - ${puntos(ptsAuto)} Pts`, COLOR.grisMedio)
  }
  columnaSimple(colTotal, `PROM. ${etiquetaTrimestre(d.trimestre.numero)} TRIM.`, COLOR.azulOscuro)
  bordear(h, FILA_GRUPO, 1, FILA_ACT, 2)

  h.getRow(FILA_GRUPO).height = 20
  h.getRow(FILA_PUNTOS).height = 18
  h.getRow(FILA_ACT).height = 100

  // ── Filas de estudiantes ────────────────────────────────────────────────────
  const minimo = d.gestion.notaMinimaAprobacion
  d.estudiantes.forEach((est, i) => {
    const fila = PRIMERA + i
    const datosFila = area.filas.find(f => f.inscripcionId === est.inscripcionId)
    const zebra = i % 2 === 1 ? COLOR.azulClaro : undefined
    const base = { borde: true, fondo: zebra, ajustar: false } as const

    poner(h, fila, 1, est.numero, base)
    poner(h, fila, 2, est.nombreCompleto, { ...base, alineacion: 'left' })

    for (const g of grupos) {
      g.actividades.forEach((act, k) => {
        poner(h, fila, g.colInicio + k, datosFila?.notas[act.id] ?? null, { ...base, formato: '0.##' })
      })
      poner(h, fila, g.colPromedio, datosFila?.promedioDimension[g.dimensionId] ?? null, {
        ...base, negrita: true, formato: '0.0', fondo: zebra ?? COLOR.grisClaro,
      })
    }
    poner(h, fila, colDesarrollo, datosFila?.desarrollo ?? null, { ...base, negrita: true })
    if (colAuto) poner(h, fila, colAuto, datosFila?.autoevaluacion ?? null, base)
    const total = datosFila?.total ?? null
    poner(h, fila, colTotal, total, {
      ...base, negrita: true, tamano: 11,
      color: total !== null && total < minimo ? COLOR.rojo : COLOR.azulOscuro,
    })
  })

  // ── Pie con estadísticas ────────────────────────────────────────────────────
  const r = area.resumen
  const ultimaFila = PRIMERA + Math.max(d.estudiantes.length, 1) - 1
  const lineas: Array<[string, number | null, string?]> = [
    ['TOTAL DE ESTUDIANTES', r.totalEstudiantes],
    ['TOTAL APROBADOS', r.aprobados],
    ['TOTAL REPROBADOS', r.reprobados],
    ['PROMEDIO TRIMESTRAL', r.promedio],
    ['PORCENTAJE DE APROBADOS', r.porcentajeAprobados, '0.0"%"'],
    ['PORCENTAJE DE REPROBADOS', r.porcentajeReprobados, '0.0"%"'],
  ]
  const colEtiqueta = Math.max(2, colTotal - 3)
  lineas.forEach(([etiqueta, valor, formato], i) => {
    const fila = ultimaFila + 2 + i
    fusionar(h, fila, colEtiqueta, fila, colTotal - 1)
    poner(h, fila, colEtiqueta, etiqueta, { alineacion: 'right', negrita: true, borde: true, fondo: COLOR.azulClaro })
    bordear(h, fila, colEtiqueta, fila, colTotal - 1)
    poner(h, fila, colTotal, valor, { negrita: true, borde: true, formato })
  })

  const filaFirma = ultimaFila + 4 + lineas.length
  fusionar(h, filaFirma, 2, filaFirma, 3)
  poner(h, filaFirma, 2, '______________________________', { alineacion: 'center' })
  fusionar(h, filaFirma + 1, 2, filaFirma + 1, 3)
  poner(h, filaFirma + 1, 2, 'FIRMA / SELLO', { negrita: true, color: COLOR.grisMedio })

  // Inmovilizar encabezados y la columna de nombres
  h.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: FILA_ACT }]

  // Línea gruesa bajo el encabezado, como en el cuaderno impreso
  for (let c = 1; c <= ULT; c++) {
    const cel = h.getCell(FILA_ACT, c)
    cel.border = { ...BORDES, bottom: { style: 'medium', color: { argb: `FF${COLOR.azulOscuro}` } } }
  }
}


// ─── BOLETÍN GENERAL (todas las áreas × trimestres de todo el curso) ─────────

const etiquetaCorta = (n: number) => `${n}T`

function hojaBoletinGeneral(
  libro: ExcelJS.Workbook, d: DatosCuaderno, gen: Map<number, PromediosGenerales>, nombre: string,
): void {
  const h = libro.addWorksheet(nombre)
  const nTrim = d.trimestres.length
  const colsPorArea = nTrim + 1                       // 1T 2T 3T + PA
  const colPrimeraArea = 3
  const colGenerales = colPrimeraArea + d.areas.length * colsPorArea
  const ULT = colGenerales + nTrim                    // promedio general de cada trimestre + anual

  h.getColumn(1).width = 5
  h.getColumn(2).width = 34
  for (let c = colPrimeraArea; c < colGenerales; c++) h.getColumn(c).width = 5.2
  for (let c = colGenerales; c <= ULT; c++) h.getColumn(c).width = 9

  const FILA_AREA = 6, FILA_COL = 7, PRIMERA = 8
  configurarImpresion(h, { filasRepetidas: `${FILA_AREA}:${FILA_COL}` })

  fusionar(h, 1, 1, 1, ULT)
  poner(h, 1, 1, `BOLETÍN GENERAL - GESTIÓN ${d.gestion.anio}`, { tamano: 14, negrita: true, color: COLOR.azulOscuro })
  h.getRow(1).height = 26
  fusionar(h, 2, 1, 2, ULT)
  poner(h, 2, 1, `${d.institucion.nombre}  |  ${d.curso.nivel} ${d.curso.grado} "${d.curso.paralelo}"  |  PROFESOR(A): ${d.docentePrincipal}`, {
    negrita: true, color: COLOR.azulMedio, alineacion: 'left', ajustar: false,
  })
  fusionar(h, 3, 1, 3, ULT)
  poner(h, 3, 1, 'Cada trimestre muestra la nota del área; PA = promedio anual del área (solo cuando existen todos los trimestres).', {
    color: COLOR.grisMedio, tamano: 9, alineacion: 'left', ajustar: false,
  })

  const cab = { negrita: true, color: COLOR.blanco, borde: true } as const
  fusionar(h, FILA_AREA, 1, FILA_COL, 1)
  poner(h, FILA_AREA, 1, 'Nº', { ...cab, fondo: COLOR.azulOscuro })
  fusionar(h, FILA_AREA, 2, FILA_COL, 2)
  poner(h, FILA_AREA, 2, 'APELLIDOS Y NOMBRES', { ...cab, fondo: COLOR.azulOscuro })
  bordear(h, FILA_AREA, 1, FILA_COL, 2)

  d.areas.forEach((a, i) => {
    const c0 = colPrimeraArea + i * colsPorArea
    const fondo = COLORES_DIMENSION[i % COLORES_DIMENSION.length]
    fusionar(h, FILA_AREA, c0, FILA_AREA, c0 + colsPorArea - 1)
    poner(h, FILA_AREA, c0, a.materia, { ...cab, fondo, tamano: 8 })
    bordear(h, FILA_AREA, c0, FILA_AREA, c0 + colsPorArea - 1)
    d.trimestres.forEach((t, k) => poner(h, FILA_COL, c0 + k, etiquetaCorta(t.numero), { ...cab, fondo, tamano: 8 }))
    poner(h, FILA_COL, c0 + nTrim, 'PA', { ...cab, fondo: COLOR.azulOscuro, tamano: 8 })
  })
  d.trimestres.forEach((t, k) => {
    fusionar(h, FILA_AREA, colGenerales + k, FILA_COL, colGenerales + k)
    poner(h, FILA_AREA, colGenerales + k, `PROM. ${etiquetaTrimestre(t.numero)} TRIM.`, { ...cab, fondo: COLOR.azulMedio, tamano: 9 })
    bordear(h, FILA_AREA, colGenerales + k, FILA_COL, colGenerales + k)
  })
  fusionar(h, FILA_AREA, ULT, FILA_COL, ULT)
  poner(h, FILA_AREA, ULT, 'PROM. ANUAL', { ...cab, fondo: COLOR.azulOscuro, tamano: 9 })
  bordear(h, FILA_AREA, ULT, FILA_COL, ULT)
  h.getRow(FILA_AREA).height = 54
  h.getRow(FILA_COL).height = 16

  const minimo = d.gestion.notaMinimaAprobacion
  const color = (n: number | null) => (n !== null && n < minimo ? COLOR.rojo : undefined)
  d.estudiantes.forEach((est, i) => {
    const fila = PRIMERA + i
    const zebra = i % 2 === 1 ? COLOR.azulClaro : undefined
    const base = { borde: true, fondo: zebra, ajustar: false } as const
    poner(h, fila, 1, est.numero, base)
    poner(h, fila, 2, est.nombreCompleto, { ...base, alineacion: 'left' })
    d.areas.forEach((a, k) => {
      const c0 = colPrimeraArea + k * colsPorArea
      const f = a.centralizador.filas.find(x => x.inscripcionId === est.inscripcionId)
      d.trimestres.forEach((t, j) => {
        const n = f?.porTrimestre[t.id] ?? null
        poner(h, fila, c0 + j, n, { ...base, tamano: 9, color: color(n) })
      })
      const pa = f?.promedioAnual ?? null
      poner(h, fila, c0 + nTrim, pa, { ...base, tamano: 9, negrita: true, color: color(pa) ?? COLOR.azulOscuro })
    })
    const g = gen.get(est.inscripcionId)
    d.trimestres.forEach((t, j) => {
      const n = g?.porTrimestre[t.id] ?? null
      poner(h, fila, colGenerales + j, n, { ...base, negrita: true, formato: '0.00', color: color(n) })
    })
    const anual = g?.anual ?? null
    poner(h, fila, ULT, anual, { ...base, negrita: true, formato: '0.00', color: color(anual) ?? COLOR.azulOscuro })
  })

  const filaFirma = PRIMERA + d.estudiantes.length + 2
  fusionar(h, filaFirma, 2, filaFirma, 2)
  poner(h, filaFirma, 2, '______________________________', { alineacion: 'center' })
  poner(h, filaFirma + 1, 2, 'FIRMA / SELLO', { negrita: true, color: COLOR.grisMedio })

  h.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: FILA_COL }]
}

// ─── MEJORES ESTUDIANTES (un cuadro por trimestre + uno anual) ───────────────

function hojaMejores(
  libro: ExcelJS.Workbook, d: DatosCuaderno, gen: Map<number, PromediosGenerales>, nombre: string,
): void {
  const h = libro.addWorksheet(nombre)
  h.columns = [{ width: 10 }, { width: 46 }, { width: 14 }]
  configurarImpresion(h, { vertical: true })

  fusionar(h, 1, 1, 1, 3)
  poner(h, 1, 1, `MEJORES ESTUDIANTES - GESTIÓN ${d.gestion.anio}`, { tamano: 14, negrita: true, color: COLOR.azulOscuro })
  h.getRow(1).height = 26
  fusionar(h, 2, 1, 2, 3)
  poner(h, 2, 1, `${d.curso.grado} "${d.curso.paralelo}"  -  ${d.institucion.nombre}`, { negrita: true, color: COLOR.azulMedio })

  const nombres = new Map(d.estudiantes.map(e => [e.inscripcionId, e.nombreCompleto]))
  const cuadros: Array<{ titulo: string; items: Array<{ inscripcionId: number; valor: number | null }> }> = [
    ...d.trimestres.map(t => ({
      titulo: t.nombre.toUpperCase(),
      items: d.estudiantes.map(e => ({ inscripcionId: e.inscripcionId, valor: gen.get(e.inscripcionId)?.porTrimestre[t.id] ?? null })),
    })),
    { titulo: 'PROMEDIO ANUAL', items: d.estudiantes.map(e => ({ inscripcionId: e.inscripcionId, valor: gen.get(e.inscripcionId)?.anual ?? null })) },
  ]

  let fila = 4
  for (const cuadro of cuadros) {
    fusionar(h, fila, 1, fila, 3)
    poner(h, fila, 1, cuadro.titulo, { negrita: true, color: COLOR.blanco, fondo: COLOR.azulMedio, borde: true })
    bordear(h, fila, 1, fila, 3)
    fila++
    ;['PUESTO', 'APELLIDOS Y NOMBRES', 'PROMEDIO'].forEach((t, c) =>
      poner(h, fila, c + 1, t, { negrita: true, color: COLOR.blanco, fondo: COLOR.azulOscuro, borde: true }))
    fila++
    const top = rankear(cuadro.items, 3)
    if (top.length === 0) {
      fusionar(h, fila, 1, fila, 3)
      poner(h, fila, 1, 'Sin notas todavía', { color: COLOR.grisMedio, borde: true })
      bordear(h, fila, 1, fila, 3)
      fila++
    }
    for (const p of top) {
      const base = { borde: true, ajustar: false } as const
      poner(h, fila, 1, `${p.puesto}°`, { ...base, negrita: true })
      poner(h, fila, 2, nombres.get(p.inscripcionId) ?? '', { ...base, alineacion: 'left' })
      poner(h, fila, 3, p.promedio, { ...base, negrita: true, formato: '0.00' })
      fila++
    }
    fila += 2
  }
}

// ─── LIBRETAS (una por estudiante, una hoja de papel cada una) ───────────────

function hojaLibretas(
  libro: ExcelJS.Workbook, d: DatosCuaderno, gen: Map<number, PromediosGenerales>, nombre: string,
): void {
  const h = libro.addWorksheet(nombre)
  const nTrim = d.trimestres.length
  const colAnual = 2 + nTrim
  const colObs = colAnual + 1
  const ULT = colObs

  h.getColumn(1).width = 44
  for (let c = 2; c <= colAnual; c++) h.getColumn(c).width = 11
  h.getColumn(colObs).width = 15
  configurarImpresion(h, { vertical: true })

  const minimo = d.gestion.notaMinimaAprobacion
  const cab = { negrita: true, color: COLOR.blanco, borde: true } as const
  const lugar = [d.institucion.municipio, d.institucion.departamento].filter(Boolean).join(' - ')

  // Áreas agrupadas por campo de saber, respetando el orden en que vienen
  const campos: Array<{ nombre: string; areas: AreaCuaderno[] }> = []
  for (const a of d.areas) {
    const nombreCampo = a.campoSaber || 'SIN CAMPO'
    const existente = campos.find(c => c.nombre === nombreCampo)
    if (existente) existente.areas.push(a); else campos.push({ nombre: nombreCampo, areas: [a] })
  }
  const filasPorBloque = 19 + campos.length + d.areas.length   // cabecera + tabla + firmas + margen

  d.estudiantes.forEach((est, idx) => {
    let f = 1 + idx * filasPorBloque

    fusionar(h, f, 1, f, ULT)
    poner(h, f, 1, 'LIBRETA DE CALIFICACIONES', { tamano: 15, negrita: true, color: COLOR.azulOscuro })
    h.getRow(f).height = 26
    fusionar(h, f + 1, 1, f + 1, ULT)
    poner(h, f + 1, 1, `GESTIÓN ${d.gestion.anio}`, { tamano: 11, negrita: true, color: COLOR.azulMedio })
    fusionar(h, f + 2, 1, f + 2, ULT)
    poner(h, f + 2, 1, d.institucion.nombre, { tamano: 12, negrita: true })
    fusionar(h, f + 3, 1, f + 3, ULT)
    poner(h, f + 3, 1, `${lugar}${d.institucion.rue ? `  |  SIE ${d.institucion.rue}` : ''}`, { tamano: 9, color: COLOR.grisMedio })

    const dato = (fila: number, texto: string) => {
      fusionar(h, fila, 1, fila, ULT)
      poner(h, fila, 1, texto, { alineacion: 'left', negrita: true, ajustar: false })
    }
    dato(f + 5, `ESTUDIANTE: ${est.nombreCompleto}`)
    dato(f + 6, `RUDE: ${est.rude}`)
    dato(f + 7, `CURSO: ${d.curso.grado} "${d.curso.paralelo}"  -  ${d.curso.nivel}  -  TURNO ${d.curso.turno}`)

    // Encabezado de la tabla
    const fc = f + 9
    poner(h, fc, 1, 'ÁREAS / CAMPOS DE SABERES', { ...cab, fondo: COLOR.azulOscuro })
    d.trimestres.forEach((t, k) => poner(h, fc, 2 + k, `${etiquetaTrimestre(t.numero)} TRIM.`, { ...cab, fondo: COLOR.azulMedio }))
    poner(h, fc, colAnual, 'PROM. ANUAL', { ...cab, fondo: COLOR.azulOscuro })
    poner(h, fc, colObs, 'OBSERVACIÓN', { ...cab, fondo: COLOR.azulOscuro })
    h.getRow(fc).height = 22

    let fila = fc + 1
    for (const campo of campos) {
      fusionar(h, fila, 1, fila, ULT)
      poner(h, fila, 1, campo.nombre, { negrita: true, color: COLOR.azulOscuro, fondo: COLOR.azulClaro, alineacion: 'left', borde: true })
      bordear(h, fila, 1, fila, ULT)
      fila++
      for (const a of campo.areas) {
        const fa = a.centralizador.filas.find(x => x.inscripcionId === est.inscripcionId)
        const base = { borde: true, ajustar: false } as const
        poner(h, fila, 1, a.materia, { ...base, alineacion: 'left' })
        d.trimestres.forEach((t, k) => {
          const n = fa?.porTrimestre[t.id] ?? null
          poner(h, fila, 2 + k, n, { ...base, color: n !== null && n < minimo ? COLOR.rojo : undefined })
        })
        const reprobado = fa?.resultado === 'RETENIDO'
        poner(h, fila, colAnual, fa?.promedioAnual ?? null, { ...base, negrita: true, color: reprobado ? COLOR.rojo : COLOR.azulOscuro })
        poner(h, fila, colObs, fa?.resultado ?? null, { ...base, tamano: 9, negrita: true, color: reprobado ? COLOR.rojo : COLOR.verde })
        fila++
      }
    }

    // Promedio general del estudiante
    const g = gen.get(est.inscripcionId)
    const base = { borde: true, negrita: true, fondo: COLOR.azulClaro, formato: '0.00', ajustar: false } as const
    poner(h, fila, 1, 'PROMEDIO GENERAL', { ...base, alineacion: 'right', formato: undefined })
    d.trimestres.forEach((t, k) => poner(h, fila, 2 + k, g?.porTrimestre[t.id] ?? null, base))
    poner(h, fila, colAnual, g?.anual ?? null, base)
    poner(h, fila, colObs, null, base)

    // Firmas
    const ff = fila + 4
    fusionar(h, ff, 1, ff, 2)
    poner(h, ff, 1, '______________________________', { alineacion: 'center' })
    fusionar(h, ff + 1, 1, ff + 1, 2)
    poner(h, ff + 1, 1, 'MAESTRO(A) DE AULA', { negrita: true, color: COLOR.grisMedio })
    fusionar(h, ff, colAnual - 1, ff, ULT)
    poner(h, ff, colAnual - 1, '______________________________', { alineacion: 'center' })
    fusionar(h, ff + 1, colAnual - 1, ff + 1, ULT)
    poner(h, ff + 1, colAnual - 1, 'DIRECTOR(A)', { negrita: true, color: COLOR.grisMedio })

    // Salto de página: la siguiente libreta empieza en hoja nueva
    if (idx < d.estudiantes.length - 1) h.getRow(f + filasPorBloque - 1).addPageBreak()
  })
}


// ─── ENCABEZADO COMÚN de las hojas de padres y horario ───────────────────────

function encabezadoCurso(h: ExcelJS.Worksheet, d: DatosCuaderno, titulo: string, ULT: number): void {
  fusionar(h, 1, 1, 1, ULT)
  poner(h, 1, 1, titulo, { tamano: 14, negrita: true, color: COLOR.azulOscuro })
  h.getRow(1).height = 26
  const mitad = Math.max(2, Math.floor(ULT / 2))
  const dato = (fila: number, izquierda: boolean, texto: string) => {
    const desde = izquierda ? 1 : mitad + 1
    fusionar(h, fila, desde, fila, izquierda ? mitad : ULT)
    poner(h, fila, desde, texto, { alineacion: 'left', negrita: true, ajustar: false })
  }
  dato(2, true, `UNIDAD EDUCATIVA: ${d.institucion.nombre}`)
  dato(2, false, `CÓDIGO SIE: ${d.institucion.rue}`)
  dato(3, true, `NIVEL: ${d.curso.nivel}`)
  dato(3, false, `CURSO: ${d.curso.grado} "${d.curso.paralelo}"`)
}

// ─── HORARIO DEL CURSO (periodos × días, desde la tabla Horario) ─────────────

const NOMBRE_DIA: Record<string, string> = {
  LUNES: 'LUNES', MARTES: 'MARTES', MIERCOLES: 'MIÉRCOLES', JUEVES: 'JUEVES', VIERNES: 'VIERNES', SABADO: 'SÁBADO',
}

function hojaHorario(libro: ExcelJS.Workbook, d: DatosCuaderno, nombre: string): void {
  const h = libro.addWorksheet(nombre)
  const { dias, franjas } = d.horario
  const ULT = 2 + dias.length
  h.getColumn(1).width = 8
  h.getColumn(2).width = 14
  for (let c = 3; c <= ULT; c++) h.getColumn(c).width = 26
  configurarImpresion(h, { filasRepetidas: '5:5' })
  encabezadoCurso(h, d, 'HORARIO DE CURSO', ULT)

  const cab = { negrita: true, color: COLOR.blanco, borde: true, fondo: COLOR.azulOscuro } as const
  poner(h, 5, 1, 'PERIODO', cab)
  poner(h, 5, 2, 'HORAS', cab)
  dias.forEach((dia, i) => poner(h, 5, 3 + i, NOMBRE_DIA[dia], { ...cab, fondo: COLOR.azulMedio }))
  h.getRow(5).height = 22

  if (franjas.length === 0) {
    fusionar(h, 6, 1, 6, ULT)
    poner(h, 6, 1, 'Este curso todavía no tiene horarios registrados en el sistema.', { color: COLOR.grisMedio, borde: true })
    bordear(h, 6, 1, 6, ULT)
    return
  }

  let fila = 6
  let periodo = 0
  for (const f of franjas) {
    if (f.recreoAntes) {
      fusionar(h, fila, 1, fila, ULT)
      poner(h, fila, 1, 'R  E  C  R  E  O', { negrita: true, color: COLOR.grisMedio, fondo: COLOR.grisClaro, borde: true })
      bordear(h, fila, 1, fila, ULT)
      h.getRow(fila).height = 16
      fila++
    }
    periodo++
    poner(h, fila, 1, periodo, { negrita: true, borde: true, fondo: COLOR.azulClaro })
    poner(h, fila, 2, `${f.inicio} - ${f.fin}`, { negrita: true, borde: true, fondo: COLOR.azulClaro, ajustar: false })
    dias.forEach((dia, i) => poner(h, fila, 3 + i, f.celdas[dia] ?? null, { borde: true, tamano: 9 }))
    h.getRow(fila).height = 30
    fila++
  }
  h.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }]
}

// ─── REGISTRO DE PADRES DE FAMILIA O TUTORES ─────────────────────────────────

function hojaRegistroPadres(libro: ExcelJS.Workbook, d: DatosCuaderno, nombre: string): void {
  const h = libro.addWorksheet(nombre)
  const ULT = 7
  ;[5, 40, 32, 16, 32, 16, 40].forEach((w, i) => { h.getColumn(i + 1).width = w })
  configurarImpresion(h, { filasRepetidas: '5:6' })
  encabezadoCurso(h, d, 'REGISTRO DE PADRES DE FAMILIA O TUTORES', ULT)

  const cab = { negrita: true, color: COLOR.blanco, borde: true } as const
  fusionar(h, 5, 1, 6, 1); poner(h, 5, 1, 'Nº', { ...cab, fondo: COLOR.azulOscuro })
  fusionar(h, 5, 2, 6, 2); poner(h, 5, 2, 'APELLIDOS Y NOMBRES ESTUDIANTE', { ...cab, fondo: COLOR.azulOscuro })
  fusionar(h, 5, 3, 5, 4); poner(h, 5, 3, 'DATOS DEL PADRE / O TUTOR', { ...cab, fondo: COLOR.azulMedio })
  fusionar(h, 5, 5, 5, 6); poner(h, 5, 5, 'DATOS DE LA MADRE', { ...cab, fondo: COLOR.azulMedio })
  fusionar(h, 5, 7, 6, 7); poner(h, 5, 7, 'DIRECCIÓN', { ...cab, fondo: COLOR.azulOscuro })
  ;['NOMBRE', 'TELÉFONO', 'NOMBRE', 'TELÉFONO'].forEach((t, i) => poner(h, 6, 3 + i, t, { ...cab, fondo: COLOR.azulMedio }))
  bordear(h, 5, 1, 6, ULT)

  d.estudiantes.forEach((e, i) => {
    const fila = 7 + i
    const base = { borde: true, ajustar: false, fondo: i % 2 === 1 ? COLOR.azulClaro : undefined } as const
    poner(h, fila, 1, e.numero, base)
    poner(h, fila, 2, e.nombreCompleto, { ...base, alineacion: 'left' })
    poner(h, fila, 3, e.padre?.nombre ?? '', { ...base, alineacion: 'left' })
    poner(h, fila, 4, e.padre?.telefono ?? '', base).numFmt = '@'
    poner(h, fila, 5, e.madre?.nombre ?? '', { ...base, alineacion: 'left' })
    poner(h, fila, 6, e.madre?.telefono ?? '', base).numFmt = '@'
    poner(h, fila, 7, e.direccion, { ...base, alineacion: 'left' })
  })
  h.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 6 }]
}

// ─── FICHA DE ENTREVISTA CON EL PADRE DE FAMILIA (en blanco, se llena a mano) ─

function hojaEntrevista(libro: ExcelJS.Workbook, d: DatosCuaderno, nombre: string): void {
  const h = libro.addWorksheet(nombre)
  const ULT = 7
  ;[12, 28, 26, 36, 36, 16, 14].forEach((w, i) => { h.getColumn(i + 1).width = w })
  configurarImpresion(h, { filasRepetidas: '6:6' })

  fusionar(h, 1, 1, 1, ULT)
  poner(h, 1, 1, 'FICHA DE ENTREVISTA CON EL PADRE DE FAMILIA', { tamano: 14, negrita: true, color: COLOR.azulOscuro })
  h.getRow(1).height = 26
  const dato = (fila: number, desde: number, hasta: number, texto: string) => {
    fusionar(h, fila, desde, fila, hasta)
    poner(h, fila, desde, texto, { alineacion: 'left', negrita: true, ajustar: false })
  }
  dato(2, 1, 3, `DOCENTE: ${d.docentePrincipal}`)
  dato(2, 4, ULT, `UNIDAD EDUCATIVA: ${d.institucion.nombre}`)
  dato(3, 1, 3, `TRIMESTRE: ${d.trimestre.nombre.toUpperCase()}`)
  dato(3, 4, 5, `CURSO: ${d.curso.grado} "${d.curso.paralelo}"`)
  dato(3, 6, ULT, `S.I.E.: ${d.institucion.rue}`)

  ;['FECHA', 'ESTUDIANTE', 'PADRE O TUTOR', 'MOTIVO DE LA ENTREVISTA', 'SUGERENCIA DE SOLUCIÓN', 'FIRMA', 'OBS.']
    .forEach((t, i) => poner(h, 6, i + 1, t, { negrita: true, color: COLOR.blanco, fondo: COLOR.azulOscuro, borde: true }))
  h.getRow(6).height = 22

  // Filas vacías con borde para escribir a mano (2 hojas A4 aprox.)
  for (let f = 7; f < 7 + 30; f++) {
    h.getRow(f).height = 28
    for (let c = 1; c <= ULT; c++) h.getCell(f, c).border = BORDES
  }
  h.views = [{ showGridLines: false, state: 'frozen', ySplit: 6 }]
}
