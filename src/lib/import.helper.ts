// src/lib/import.helper.ts
//
// Mecánica común de las importaciones (estudiantes, docentes, tutores):
// recorrer filas, aislar los errores por fila y devolver el mismo reporte.

import { ErrorDeUsuario } from './errores.js'
import type { FilaImportada, ResultadoImport } from './excel.helper.js'

// Columna de la plantilla que corresponde a cada campo validado con zod, para que
// el mensaje diga "CI: ..." (lo que el usuario ve en su Excel) y no "ci".
const COLUMNA_POR_CAMPO: Record<string, string> = {
  ci: 'CI', nombre: 'Nombre', apellido: 'Apellido', fechaNacimiento: 'FechaNacimiento',
  direccion: 'Direccion', rude: 'RUDE', telefono: 'Telefono', email: 'Email',
  especialidad: 'Especialidad', ocupacion: 'Ocupacion', gradoInstruccion: 'GradoInstruccion',
  sexo: 'Sexo', nacionalidad: 'Nacionalidad', fotoUrl: 'FotoUrl',
}

export function mensajeValidacion(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  return issues
    .map(i => {
      const campo = i.path.length ? String(i.path[0]) : ''
      const columna = COLUMNA_POR_CAMPO[campo] ?? campo
      return columna ? `${columna}: ${i.message}` : i.message
    })
    .join('; ')
}

export { sinTildes } from './persona.helper.js'

function mensajeDeFila(e: unknown): string {
  if (e instanceof ErrorDeUsuario) return e.message
  // Carrera entre dos importaciones simultáneas: la BD rechaza el CI repetido
  if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
    return 'Ya existe un registro con esos datos (CI repetido)'
  }
  // Cualquier otra cosa puede traer detalles internos (SQL, rutas): se registra y NO se muestra.
  console.error('[import] error inesperado en una fila:', e)
  return 'Error inesperado al guardar esta fila'
}

export async function ejecutarImport<T>(
  filas: FilaImportada[],
  procesar: (fila: FilaImportada) => Promise<T>,
): Promise<ResultadoImport<T>> {
  const resultado: ResultadoImport<T> = { totalFilas: filas.length, exitosas: 0, fallidas: 0, creados: [], errores: [] }
  for (const f of filas) {
    try {
      resultado.creados.push(await procesar(f))
      resultado.exitosas++
    } catch (e) {
      resultado.fallidas++
      resultado.errores.push({ fila: f.fila, error: mensajeDeFila(e) })
    }
  }
  return resultado
}