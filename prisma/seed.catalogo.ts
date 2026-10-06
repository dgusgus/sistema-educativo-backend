// prisma/seed.catalogo.ts
//
// Datos INSTITUCIONALES que no dependen de ninguna gestión: la institución, los
// campos de saber del currículo y el catálogo de materias. Los usan los dos seeds:
//   • seed.ts            → demo/desarrollo (colegio ficticio completo)
//   • seed.produccion.ts → primer arranque en un servidor real
//
// Es seguro ejecutarlo varias veces: solo crea lo que falta y nunca pisa lo que
// el director ya haya editado desde la aplicación.

import type { PrismaClient } from './generated/prisma/client.js'

export const INSTITUCION = {
  id: 1,
  nombre: 'Unidad Educativa "Los Ángeles de Nazaria Ignacia"',
  direccion: 'Urbanización Bustillos, Zona Los Ángeles',
  telefono: '(052) 123456',
  email: 'ue.angeles.nazaria@gmail.com',
  rue: '81230370',
  municipio: 'Oruro',
  departamento: 'Oruro',
  dependencia: 'FISCAL' as const,
}

// Campos de saber y de conocimiento del currículo base (SEP, Bolivia).
// "Cosmos y Pensamiento" queda sin materias a propósito en este catálogo: el
// colegio agrega aquí (Valores, Espiritualidades y Religiones; Filosofía...) lo que use.
export const CAMPOS_SABER = [
  { nombre: 'Comunidad y Sociedad',             orden: 1 },
  { nombre: 'Ciencia, Tecnología y Producción', orden: 2 },
  { nombre: 'Vida, Tierra y Territorio',        orden: 3 },
  { nombre: 'Cosmos y Pensamiento',             orden: 4 },
] as const

export const MATERIAS = [
  { codigo: 'MAT', nombre: 'Matemáticas',                 horas: 5, campo: 'Ciencia, Tecnología y Producción' },
  { codigo: 'LEN', nombre: 'Lenguaje',                    horas: 5, campo: 'Comunidad y Sociedad' },
  { codigo: 'CNA', nombre: 'Ciencias Naturales',          horas: 4, campo: 'Vida, Tierra y Territorio' },
  { codigo: 'CSO', nombre: 'Ciencias Sociales',           horas: 4, campo: 'Comunidad y Sociedad' },
  { codigo: 'ING', nombre: 'Inglés',                      horas: 3, campo: 'Comunidad y Sociedad' },
  { codigo: 'EFI', nombre: 'Educación Física',            horas: 3, campo: 'Comunidad y Sociedad' },
  { codigo: 'ART', nombre: 'Artes Plásticas',             horas: 2, campo: 'Comunidad y Sociedad' },
  { codigo: 'TEC', nombre: 'Técnica Tecnológica',         horas: 3, campo: 'Ciencia, Tecnología y Producción' },
  { codigo: 'QUE', nombre: 'Lengua Originaria (Quechua)', horas: 2, campo: 'Comunidad y Sociedad' },
] as const

export async function sembrarCatalogo(prisma: PrismaClient) {
  await prisma.institucion.upsert({ where: { id: 1 }, update: {}, create: INSTITUCION })

  const campoId = new Map<string, number>()
  for (const c of CAMPOS_SABER) {
    const row = await prisma.campoSaber.upsert({ where: { nombre: c.nombre }, update: {}, create: c })
    campoId.set(c.nombre, row.id)
  }

  const materias: Record<string, { id: number }> = {}
  for (const m of MATERIAS) {
    materias[m.codigo] = await prisma.materia.upsert({
      where: { codigo: m.codigo }, update: {},
      create: { codigo: m.codigo, nombre: m.nombre, horasSemanales: m.horas, campoSaberId: campoId.get(m.campo)! },
    })
    // Bases que ya existían sin campo de saber: se completa SOLO si está vacío (no pisa ediciones)
    await prisma.materia.updateMany({ where: { codigo: m.codigo, campoSaberId: null }, data: { campoSaberId: campoId.get(m.campo)! } })
  }
  return { materias, campoId }
}