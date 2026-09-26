// src/lib/excel.helper.ts
//
// Helpers genéricos de import/export — cada entidad (estudiante, docente,
// tutor...) define sus propias columnas y validación, pero la mecánica
// de leer filas y devolver un reporte fila-por-fila es la misma siempre.

import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'

export interface FilaImportada {
  fila: number                    // número de fila real en el Excel (para que el usuario la ubique)
  datos: Record<string, unknown>
}

export interface ResultadoImport<T> {
  totalFilas: number
  exitosas: number
  fallidas: number
  creados: T[]
  errores: Array<{ fila: number; error: string }>
}

// Lee la primera hoja de un buffer .xlsx y devuelve las filas como
// objetos, usando la primera fila como encabezado (nombre de columna).
export async function leerExcel(buffer: Buffer, nombreArchivo: string): Promise<FilaImportada[]> {
  const workbook = new ExcelJS.Workbook()
  const esCsv = nombreArchivo.toLowerCase().endsWith('.csv')

  if (esCsv) {
    // exceljs también sabe leer CSV, solo pide un stream en vez de un buffer
    await workbook.csv.read(Readable.from(buffer))
  } else {
    await workbook.xlsx.load(buffer as any)
  }

  const hoja = workbook.worksheets[0]
  if (!hoja) throw new Error('El archivo no tiene hojas')

  const encabezados: string[] = []
  hoja.getRow(1).eachCell((cell, col) => { encabezados[col] = String(cell.value ?? '').trim() })

  const filas: FilaImportada[] = []
  hoja.eachRow((row, numeroFila) => {
    if (numeroFila === 1) return   // saltar encabezado
    const datos: Record<string, unknown> = {}
    row.eachCell((cell, col) => {
      const nombreCol = encabezados[col]
      if (nombreCol) datos[nombreCol] = cell.value
    })
    if (Object.values(datos).some(v => v !== null && v !== undefined && v !== '')) {
      filas.push({ fila: numeroFila, datos })
    }
  })
  return filas
}

// Genera un .xlsx a partir de filas de datos ya planas (un objeto por
// fila, mismas claves = columnas).
export async function generarExcel(nombreHoja: string, columnas: string[], filas: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const hoja = workbook.addWorksheet(nombreHoja)
  hoja.columns = columnas.map(c => ({ header: c, key: c, width: 20 }))
  hoja.getRow(1).font = { bold: true }
  filas.forEach(f => hoja.addRow(f))

  // ✅ Buffer.from() normaliza lo que devuelva writeBuffer() (que es un
  // Buffer "de exceljs", no necesariamente idéntico en tipos al Buffer
  // de Node) a un Buffer real de Node — más correcto que castear con
  // "as", porque reconstruye el dato en vez de solo convencer al compilador.
  const resultado = await workbook.xlsx.writeBuffer()
  return Buffer.from(resultado as ArrayBuffer)
}