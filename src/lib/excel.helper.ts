// src/lib/excel.helper.ts
//
// Lectura y generación de Excel (.xlsx) para las importaciones y exportaciones.
// Cada entidad (estudiante, docente, tutor) define sus columnas; la mecánica de
// leer el archivo con seguridad y entregar filas limpias es la misma siempre.
//
// Por qué se reescribió la lectura (probado con archivos reales):
//  • Antes una celda con FÓRMULA o texto con formato mixto llegaba como objeto y
//    String(objeto) guardaba "[object Object]" como CI o nombre.
//  • Los encabezados se comparaban letra por letra: "ci" o "Dirección" (con tilde)
//    no coincidían y el dato se perdía en silencio.
//  • Un .xls viejo o un archivo falso terminaba en un 500 sin explicación.
//  • No había tope de filas.

import ExcelJS from 'exceljs'
import { ErrorDeUsuario } from './errores.js'

export const MAX_FILAS_IMPORT = 1000

// Valor de una celda ya "aplanado" (sin objetos de exceljs).
export type CeldaSimple = string | number | boolean | Date | { error: string } | null

export interface ColumnaImport {
  clave:        string        // encabezado de la plantilla, p. ej. "FechaNacimiento"
  alias?:       string[]      // otras formas aceptadas, p. ej. "Fecha de nacimiento"
  obligatoria?: boolean
}

export interface FilaImportada {
  fila:  number                         // número de fila real en el Excel (para que el usuario la ubique)
  datos: Record<string, CeldaSimple>    // claves = ColumnaImport.clave
}

export interface ResultadoLectura {
  filas:        FilaImportada[]
  advertencias: string[]
}

export interface ResultadoImport<T> {
  totalFilas:    number
  exitosas:      number
  fallidas:      number
  creados:       T[]
  errores:       Array<{ fila: number; error: string }>
  advertencias?: string[]
}

// "Dirección", "DIRECCION" y " direccion " → "direccion"
const normalizar = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

// ─── Valor de celda ──────────────────────────────────────────────────────────
function valorCelda(v: ExcelJS.CellValue): CeldaSimple {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') { const t = v.trim(); return t === '' ? null : t }
  if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v

  if (typeof v === 'object') {
    if ('error' in v) return { error: String(v.error) }

    // Fórmula: se usa el resultado que Excel dejó guardado en el archivo.
    if ('formula' in v || 'sharedFormula' in v) {
      const r = (v as { result?: ExcelJS.CellValue }).result
      if (r === undefined) return { error: 'fórmula sin valor calculado — abre el archivo en Excel y guárdalo de nuevo' }
      return valorCelda(r)
    }
    // Texto con formato mixto (negrita en una parte, etc.)
    if ('richText' in v) {
      const t = v.richText.map(p => p.text).join('').trim()
      return t === '' ? null : t
    }
    // Hipervínculo: interesa el texto visible
    if ('text' in v) return valorCelda(v.text as ExcelJS.CellValue)
  }
  return { error: 'tipo de celda no soportado' }
}

// Texto de una celda ("" si está vacía). Los números enteros salen sin ".0" ni notación científica.
export function texto(v: CeldaSimple | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v)
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  throw new ErrorDeUsuario(`La celda tiene un error de Excel (${v.error})`)
}

// Fecha de una celda → "AAAA-MM-DD" (o null si está vacía). Acepta fecha real de
// Excel, número de serie, "dd/mm/aaaa", "d-m-aaaa", "dd.mm.aaaa" y "aaaa-mm-dd".
// La validez en el calendario (31 de febrero...) la comprueba después el esquema zod.
export function fecha(v: CeldaSimple | undefined, columna = 'Fecha'): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && !(v instanceof Date)) throw new ErrorDeUsuario(`La celda ${columna} tiene un error de Excel (${v.error})`)

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new ErrorDeUsuario(`${columna}: fecha inválida`)
    return v.toISOString().slice(0, 10)
  }
  if (typeof v === 'number') {                    // número de serie de Excel (celda sin formato de fecha)
    if (v < 1 || v > 80_000) throw new ErrorDeUsuario(`${columna}: "${v}" no es una fecha`)
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10)
  }
  if (typeof v === 'boolean') throw new ErrorDeUsuario(`${columna}: no es una fecha`)

  const t = v.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  throw new ErrorDeUsuario(`${columna}: "${t}" no es una fecha válida (usa dd/mm/aaaa, con año de 4 dígitos)`)
}

// ─── Lectura ─────────────────────────────────────────────────────────────────
// Lee la PRIMERA hoja de un .xlsx. La fila 1 son los encabezados; se reconocen
// sin importar mayúsculas, tildes ni espacios ("ci", "Dirección", "Fecha de nacimiento").
export async function leerExcel(buffer: Buffer, columnas: ColumnaImport[]): Promise<ResultadoLectura> {
  // Un .xlsx es un ZIP: debe empezar con "PK\x03\x04". Esto detecta .xls antiguos,
  // CSV renombrados y archivos que no son Excel, con un mensaje claro.
  const esZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
  if (!esZip) {
    throw new ErrorDeUsuario(
      'El archivo no es un Excel .xlsx válido. Si es un .xls antiguo o un .csv, ábrelo en Excel y guárdalo como "Libro de Excel (.xlsx)".'
    )
  }

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  } catch {
    throw new ErrorDeUsuario('No se pudo leer el archivo. Verifica que no esté dañado ni protegido con contraseña.')
  }

  const hoja = workbook.worksheets[0]
  if (!hoja) throw new ErrorDeUsuario('El archivo no tiene hojas')

  // Encabezados → columna conocida
  const porNombre = new Map<string, ColumnaImport>()
  for (const c of columnas) for (const n of [c.clave, ...(c.alias ?? [])]) porNombre.set(normalizar(n), c)

  const advertencias: string[] = []
  const claveDeColumna = new Map<number, string>()       // nº de columna del Excel → clave
  const yaMapeadas = new Set<string>()

  hoja.getRow(1).eachCell((cell, col) => {
    const original = texto(valorCelda(cell.value) as CeldaSimple)
    if (!original) return
    const conocida = porNombre.get(normalizar(original))
    if (!conocida) { advertencias.push(`La columna "${original}" no se reconoce y se ignoró`); return }
    if (yaMapeadas.has(conocida.clave)) { advertencias.push(`La columna "${original}" está repetida; se usó la primera`); return }
    yaMapeadas.add(conocida.clave)
    claveDeColumna.set(col, conocida.clave)
  })

  if (claveDeColumna.size === 0) {
    throw new ErrorDeUsuario('La primera fila debe tener los encabezados de las columnas. Descarga la plantilla para ver el formato.')
  }
  const faltantes = columnas.filter(c => c.obligatoria && !yaMapeadas.has(c.clave)).map(c => c.clave)
  if (faltantes.length > 0) {
    throw new ErrorDeUsuario(
      `Falta${faltantes.length > 1 ? 'n las columnas obligatorias' : ' la columna obligatoria'}: ${faltantes.join(', ')}. ` +
      'Revisa que estén en la primera hoja y en la fila 1 (descarga la plantilla).'
    )
  }

  // Filas de datos
  const filas: FilaImportada[] = []
  hoja.eachRow((row, numeroFila) => {
    if (numeroFila === 1) return
    const datos: Record<string, CeldaSimple> = {}
    let conDatos = false
    for (const [col, clave] of claveDeColumna) {
      const v = valorCelda(row.getCell(col).value)
      datos[clave] = v
      if (v !== null) conDatos = true
    }
    if (conDatos) filas.push({ fila: numeroFila, datos })
  })

  if (filas.length > MAX_FILAS_IMPORT) {
    throw new ErrorDeUsuario(
      `El archivo tiene ${filas.length} filas con datos; el máximo por importación es ${MAX_FILAS_IMPORT}. Divídelo en varios archivos.`
    )
  }
  return { filas, advertencias }
}

// ─── Generación ──────────────────────────────────────────────────────────────
export interface InstruccionColumna {
  columna:     string
  obligatoria: boolean
  descripcion: string
  ejemplo?:    string
}

export interface OpcionesExcel {
  columnasTexto?:  string[]               // formato Texto: conserva ceros a la izquierda (CI, RUDE, teléfono)
  columnasFecha?:  string[]               // formato dd/mm/aaaa
  instrucciones?:  InstruccionColumna[]   // agrega una 2.ª hoja "Instrucciones" (la lectura solo usa la 1.ª)
}

// Genera un .xlsx a partir de filas planas (un objeto por fila, claves = columnas).
export async function generarExcel(
  nombreHoja: string,
  columnas: string[],
  filas: Record<string, unknown>[],
  opciones: OpcionesExcel = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const hoja = workbook.addWorksheet(nombreHoja)
  hoja.columns = columnas.map(c => ({ header: c, key: c, width: 20 }))
  for (const c of opciones.columnasTexto ?? []) hoja.getColumn(c).numFmt = '@'
  for (const c of opciones.columnasFecha ?? []) hoja.getColumn(c).numFmt = 'dd/mm/yyyy'
  hoja.getRow(1).font = { bold: true }
  filas.forEach(f => hoja.addRow(f))

  if (opciones.instrucciones) {
    const h2 = workbook.addWorksheet('Instrucciones')
    h2.columns = [
      { header: 'Columna',      key: 'columna',     width: 20 },
      { header: 'Obligatoria',  key: 'obligatoria', width: 14 },
      { header: 'Qué escribir', key: 'descripcion', width: 60 },
      { header: 'Ejemplo',      key: 'ejemplo',     width: 28 },
    ]
    h2.getRow(1).font = { bold: true }
    for (const i of opciones.instrucciones) {
      h2.addRow({ columna: i.columna, obligatoria: i.obligatoria ? 'Sí' : 'No', descripcion: i.descripcion, ejemplo: i.ejemplo ?? '' })
    }
    h2.addRow({})
    for (const nota of [
      'Reglas generales:',
      `• Máximo ${MAX_FILAS_IMPORT} filas por archivo. Solo se lee la primera hoja ("${nombreHoja}").`,
      '• No cambies los nombres de la primera fila. Guarda siempre como "Libro de Excel (.xlsx)".',
      '• Fechas: dd/mm/aaaa con año de 4 dígitos (por ejemplo 15/03/2010).',
      '• Las filas con errores se reportan con su número y no impiden importar las demás.',
    ]) h2.addRow({ columna: nota })
  }

  // Buffer.from() normaliza lo que devuelve writeBuffer() a un Buffer real de Node.
  const resultado = await workbook.xlsx.writeBuffer()
  return Buffer.from(resultado as ArrayBuffer)
}