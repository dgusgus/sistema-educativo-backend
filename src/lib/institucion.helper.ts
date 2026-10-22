// src/lib/institucion.helper.ts
//
// Datos del colegio para quien los necesite SIN hacer su propia consulta (encabezados de PDF,
// que se dibujan de forma síncrona). El sistema es de UNA institución (fila id = 1).
//
// ¿Para qué? Antes el nombre, la dirección y el RUE estaban escritos dentro del código de los PDF.
// Ahora todo sale de la tabla Institucion: cambiar de colegio es cambiar esos datos en la pantalla
// "Datos de la Institución", sin tocar código.
//
// Caché de 60 s: los PDF no consultan la BD en cada encabezado. Al guardar los datos se refresca
// al instante (`refrescarInstitucion`).

import { prisma } from './prisma.js'

export interface DatosInstitucion {
  nombre: string
  direccion: string
  telefono: string
  email: string
  rue: string
  municipio: string
  distrito: string
  departamento: string
  logoUrl: string
  /** false mientras el Director no haya guardado los datos del colegio */
  configurada: boolean
}

const VACIA: DatosInstitucion = {
  nombre: 'UNIDAD EDUCATIVA', direccion: '', telefono: '', email: '', rue: '',
  municipio: '', distrito: '', departamento: '', logoUrl: '', configurada: false,
}

let cache: DatosInstitucion = VACIA
let cargadaEn = 0
let cargando: Promise<DatosInstitucion> | null = null
const VIGENCIA_MS = 60_000

export async function refrescarInstitucion(): Promise<DatosInstitucion> {
  if (cargando) return cargando
  cargando = (async () => {
    try {
      const i = await prisma.institucion.findUnique({ where: { id: 1 } })
      cache = i ? {
        nombre: i.nombre, direccion: i.direccion ?? '', telefono: i.telefono ?? '', email: i.email ?? '',
        rue: i.rue ?? '', municipio: i.municipio ?? '', distrito: i.distrito ?? '', departamento: i.departamento ?? '',
        logoUrl: i.logoUrl ?? '', configurada: true,
      } : VACIA
      cargadaEn = Date.now()
    } finally { cargando = null }
    return cache
  })()
  return cargando
}

/** Versión síncrona: devuelve lo último que se cargó y, si está vencido, refresca en segundo plano. */
export function institucionActual(): DatosInstitucion {
  if (Date.now() - cargadaEn > VIGENCIA_MS) void refrescarInstitucion().catch(() => { /* se reintenta en la próxima */ })
  return cache
}
