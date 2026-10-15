// src/lib/excel/estilos.ts
//
// Estilos compartidos de TODOS los libros Excel que genera el sistema.
//
// ¿Para qué? Para que la carátula, la filiación, los registros y los centralizadores
// se vean como un mismo documento institucional, y para que cambiar un color o un
// borde se haga en UN archivo (antes cada hoja del Excel original tenía su formato
// copiado a mano). Los colores son los mismos de lib/pdf.ts, así Excel y PDF coinciden.

import type ExcelJS from 'exceljs'

export const COLOR = {
  azulOscuro: '1A3C5E',
  azulMedio:  '2E6DA4',
  azulClaro:  'EBF2FA',
  grisClaro:  'F5F5F5',
  grisMedio:  '666666',
  blanco:     'FFFFFF',
  rojo:       'C0392B',
  verde:      '2E7D32',
} as const

/** Un color distinto por dimensión (Ser / Saber / Hacer…), en este orden. */
export const COLORES_DIMENSION = ['2E6DA4', '2E7D32', 'B7791F', '7B4FA0', '00838F'] as const

const BORDE_FINO: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF9AA5B1' } }
export const BORDES: Partial<ExcelJS.Borders> = {
  top: BORDE_FINO, left: BORDE_FINO, bottom: BORDE_FINO, right: BORDE_FINO,
}

const argb = (hex: string) => `FF${hex}`

export function rellenar(celda: ExcelJS.Cell, hex: string): void {
  celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } }
}

/** Fusiona un rango solo si abarca más de una celda (fusionar una sola celda da error). */
export function fusionar(hoja: ExcelJS.Worksheet, fila1: number, col1: number, fila2: number, col2: number): void {
  if (fila1 === fila2 && col1 === col2) return
  hoja.mergeCells(fila1, col1, fila2, col2)
}

interface OpcionesCelda {
  negrita?: boolean
  tamano?: number
  color?: string
  fondo?: string
  alineacion?: 'left' | 'center' | 'right'
  vertical?: 'top' | 'middle' | 'bottom'
  rotar?: number
  ajustar?: boolean
  borde?: boolean
  formato?: string
}

/** Escribe un valor y le aplica el estilo de una sola vez. */
export function poner(
  hoja: ExcelJS.Worksheet, fila: number, col: number,
  valor: ExcelJS.CellValue, o: OpcionesCelda = {},
): ExcelJS.Cell {
  const c = hoja.getCell(fila, col)
  c.value = valor
  c.font = { name: 'Calibri', size: o.tamano ?? 10, bold: o.negrita ?? false, color: { argb: argb(o.color ?? '222222') } }
  c.alignment = {
    horizontal: o.alineacion ?? 'center',
    vertical: o.vertical ?? 'middle',
    wrapText: o.ajustar ?? true,
    ...(o.rotar !== undefined ? { textRotation: o.rotar } : {}),
  }
  if (o.fondo) rellenar(c, o.fondo)
  if (o.borde) c.border = BORDES
  if (o.formato) c.numFmt = o.formato
  return c
}

/** Aplica borde a todas las celdas de un rango (las fusionadas necesitan borde en cada celda). */
export function bordear(hoja: ExcelJS.Worksheet, fila1: number, col1: number, fila2: number, col2: number): void {
  for (let f = fila1; f <= fila2; f++) {
    for (let c = col1; c <= col2; c++) hoja.getCell(f, c).border = BORDES
  }
}

/** Hoja lista para imprimir: A4 horizontal, ancho ajustado a una página, encabezados repetidos. */
export function configurarImpresion(
  hoja: ExcelJS.Worksheet,
  opciones: { vertical?: boolean; filasRepetidas?: string } = {},
): void {
  hoja.pageSetup = {
    paperSize: 9,   // A4
    orientation: opciones.vertical ? 'portrait' : 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    ...(opciones.filasRepetidas ? { printTitlesRow: opciones.filasRepetidas } : {}),
  }
  hoja.views = [{ showGridLines: false }]
}

/**
 * Nombre de hoja válido en Excel: máximo 31 caracteres, sin  \ / ? * [ ] :  y único.
 * Si ya existe uno igual se agrega " (2)", " (3)"…
 */
export function nombreHoja(base: string, usados: Set<string>): string {
  const limpio = base.replace(/[\\/?*[\]:]/g, '-').trim().slice(0, 31) || 'Hoja'
  let nombre = limpio
  for (let n = 2; usados.has(nombre.toLowerCase()); n++) {
    const sufijo = ` (${n})`
    nombre = limpio.slice(0, 31 - sufijo.length) + sufijo
  }
  usados.add(nombre.toLowerCase())
  return nombre
}
