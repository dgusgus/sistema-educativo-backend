// src/controllers/cuaderno.controller.ts
//
// Capa HTTP del cuaderno pedagógico: comprueba permisos, pide los datos al servicio
// y devuelve el .xlsx. Sin reglas de negocio ni consultas de notas aquí.

import type { Request, Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { prisma } from '../lib/prisma.js'
import { NoEncontrado, Prohibido } from '../lib/errores.js'
import { esAdmin, esDocenteDelCurso } from '../lib/ownership.helper.js'
import { obtenerDatosCuaderno, obtenerDatosGestion } from '../services/cuaderno.service.js'
import { construirCuaderno, construirCuadernoGestion } from '../lib/excel/cuaderno.builder.js'

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// "Primaria 3 A" → "primaria_3_A" (solo ASCII: los nombres con tildes se rompen en algunas descargas)
const paraArchivo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')

// Permisos compartidos: Director/Secretaría ven todo; el docente solo su curso y sus áreas.
async function resolverAcceso(req: Request, cursoId: number): Promise<number | undefined> {
  const curso = await prisma.curso.findUnique({ where: { id: cursoId }, select: { gestionId: true } })
  if (!curso) throw new NoEncontrado('Curso')
  if (!(await esDocenteDelCurso(req, cursoId, curso.gestionId))) throw new Prohibido()
  if (esAdmin(req)) return undefined
  const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user!.id }, select: { id: true } })
  if (!docente) throw new Prohibido()
  return docente.id
}

// GET /api/cuaderno/:cursoId/trimestre/:trimestreId/excel
// Director y Secretaría: todas las áreas del curso.
// Docente: solo si enseña en el curso, y únicamente SUS áreas.
export const descargarCuadernoExcel = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const cursoId = Number(req.params.cursoId)
  const trimestreId = Number(req.params.trimestreId)

  const curso = await prisma.curso.findUnique({ where: { id: cursoId }, select: { gestionId: true } })
  if (!curso) throw new NoEncontrado('Curso')
  if (!(await esDocenteDelCurso(req, cursoId, curso.gestionId))) throw new Prohibido()

  let soloDocenteId: number | undefined
  if (!esAdmin(req)) {
    const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user!.id }, select: { id: true } })
    if (!docente) throw new Prohibido()
    soloDocenteId = docente.id
  }

  const datos = await obtenerDatosCuaderno(cursoId, trimestreId, soloDocenteId)
  const buffer = await construirCuaderno(datos)

  const nombre = paraArchivo(`cuaderno ${datos.curso.nivel} ${datos.curso.grado} ${datos.curso.paralelo} T${datos.trimestre.numero} ${datos.gestion.anio}`)
  res.setHeader('Content-Type', TIPO_XLSX)
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`)
  res.send(buffer)
})


// GET /api/cuaderno/:cursoId/gestion/excel
// Un solo libro con los trimestres de la gestión y todas las asistencias.
export const descargarCuadernoGestionExcel = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const cursoId = Number(req.params.cursoId)
  const soloDocenteId = await resolverAcceso(req, cursoId)

  const porTrimestre = await obtenerDatosGestion(cursoId, soloDocenteId)
  const buffer = await construirCuadernoGestion(porTrimestre)

  const d = porTrimestre[0]
  const nombre = paraArchivo(`cuaderno gestion ${d.curso.nivel} ${d.curso.grado} ${d.curso.paralelo} ${d.gestion.anio}`)
  res.setHeader('Content-Type', TIPO_XLSX)
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`)
  res.send(buffer)
})
