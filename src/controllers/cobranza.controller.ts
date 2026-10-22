// src/controllers/cobranza.controller.ts
//
// Capa HTTP del control de cobranza y de la gestión de conceptos (editar / generar cuotas).
// Sin reglas de negocio: eso está en services/cobranza.service.ts y lib/cobranza.ts.

import type { Request, Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { prisma } from '../lib/prisma.js'
import { ErrorDeUsuario, NoEncontrado } from '../lib/errores.js'
import { obtenerCobranza, obtenerPagosRecibidos, type FiltroCobranza, type FiltroPagosRecibidos } from '../services/cobranza.service.js'
import { generarCuotasMensuales, generarCuotasTrimestrales } from '../lib/cobranza.js'
import { construirExcelCobranza } from '../lib/excel/cobranza.builder.js'

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const dia = (d: Date) => d.toISOString().slice(0, 10)

// GET /api/pagos/cobranza?gestionId&trimestreId&cursoId&conceptoId
export const getCobranza = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  res.status(200).json(await obtenerCobranza(req.query as unknown as FiltroCobranza))
})

// GET /api/pagos/cobranza/recibidos?...  (pagos ya cobrados, con totales por método)
export const getPagosRecibidos = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  res.status(200).json(await obtenerPagosRecibidos(req.query as unknown as FiltroPagosRecibidos))
})

// GET /api/pagos/cobranza/excel?...  (resumen por curso + deudores)
export const descargarCobranzaExcel = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const cobranza = await obtenerCobranza(req.query as unknown as FiltroCobranza)
  const institucion = await prisma.institucion.findUnique({ where: { id: 1 }, select: { nombre: true } })
  const buffer = await construirExcelCobranza(cobranza, institucion?.nombre ?? '')
  res.setHeader('Content-Type', TIPO_XLSX)
  res.setHeader('Content-Disposition', `attachment; filename="cobranza_${cobranza.gestion.anio}_${cobranza.hoy}.xlsx"`)
  res.send(buffer)
})

// PUT /api/pagos/conceptos/:id
export const actualizarConcepto = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const b = req.body as {
    nombre?: string; descripcion?: string | null; monto?: number; obligatorio?: boolean; activo?: boolean
    fechaVencimiento?: string | null; trimestreId?: number | string | null
  }
  const actual = await prisma.conceptoPago.findUnique({ where: { id } })
  if (!actual) throw new NoEncontrado('Concepto de pago')

  let trimestreId: number | null | undefined
  if (b.trimestreId !== undefined) {
    trimestreId = b.trimestreId === '' || b.trimestreId === null ? null : Number(b.trimestreId)
    if (trimestreId !== null) {
      const t = await prisma.trimestre.findUnique({ where: { id: trimestreId }, select: { gestionId: true } })
      if (!t || t.gestionId !== actual.gestionId) throw new ErrorDeUsuario('El trimestre no pertenece a la gestión del concepto')
    }
  }

  const concepto = await prisma.conceptoPago.update({
    where: { id },
    data: {
      ...(b.nombre !== undefined && { nombre: b.nombre }),
      ...(b.descripcion !== undefined && { descripcion: b.descripcion }),
      ...(b.monto !== undefined && { monto: b.monto }),
      ...(b.obligatorio !== undefined && { obligatorio: b.obligatorio }),
      ...(b.activo !== undefined && { activo: b.activo }),
      ...(b.fechaVencimiento !== undefined && { fechaVencimiento: b.fechaVencimiento ? new Date(b.fechaVencimiento) : null }),
      ...(trimestreId !== undefined && { trimestreId }),
    },
  })
  res.status(200).json(concepto)
})

// POST /api/pagos/conceptos/generar  → crea de una vez las cuotas del año (pensión mensual o por trimestre)
export const generarConceptos = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const b = req.body as {
    gestionId: number; tipo: 'MENSUAL' | 'TRIMESTRAL'; nombreBase: string; monto: number; obligatorio?: boolean
    mesDesde?: number; mesHasta?: number; diaVencimiento?: number; diasPlazo?: number
  }
  const gestion = await prisma.gestion.findUnique({ where: { id: b.gestionId }, select: { id: true, anio: true } })
  if (!gestion) throw new NoEncontrado('Gestión')
  const trimestres = (await prisma.trimestre.findMany({ where: { gestionId: gestion.id }, orderBy: { numero: 'asc' } }))
    .map(t => ({ id: t.id, nombre: t.nombre, fechaInicio: dia(t.fechaInicio), fechaFin: dia(t.fechaFin) }))
  if (trimestres.length === 0) throw new ErrorDeUsuario('La gestión no tiene trimestres: créalos antes de generar cuotas')

  let cuotas
  if (b.tipo === 'MENSUAL') {
    const desde = b.mesDesde ?? 2, hasta = b.mesHasta ?? 11
    if (desde > hasta) throw new ErrorDeUsuario('El mes inicial no puede ser posterior al mes final')
    cuotas = generarCuotasMensuales(b.nombreBase, gestion.anio, desde, hasta, b.diaVencimiento ?? 10, trimestres)
  } else {
    cuotas = generarCuotasTrimestrales(b.nombreBase, trimestres, b.diasPlazo ?? 15)
  }

  // ConceptoPago no tiene restricción única: se evita duplicar por nombre (se puede volver a generar sin miedo)
  const existentes = new Set((await prisma.conceptoPago.findMany({ where: { gestionId: gestion.id }, select: { nombre: true } }))
    .map(c => c.nombre.trim().toLowerCase()))
  const nuevas = cuotas.filter(c => !existentes.has(c.nombre.trim().toLowerCase()))

  if (nuevas.length) {
    await prisma.conceptoPago.createMany({
      data: nuevas.map(c => ({
        gestionId: gestion.id, nombre: c.nombre, monto: b.monto, obligatorio: b.obligatorio ?? true,
        fechaVencimiento: new Date(c.fechaVencimiento), trimestreId: c.trimestreId, periodicidad: c.periodicidad,
      })),
    })
  }
  res.status(201).json({ creados: nuevas.length, yaExistian: cuotas.length - nuevas.length })
})
