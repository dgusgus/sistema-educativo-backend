import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'

// ─── GET /api/conceptos-pago ──────────────────────────────────────────────────
export const getConceptosPago = async (req: Request, res: Response): Promise<void> => {
  const { gestionId } = req.query as { gestionId?: string }

  try {
    const where = gestionId ? { gestionId: Number(gestionId) } : { gestion: { activa: true } }

    const conceptos = await prisma.conceptoPago.findMany({
      where,
      include: { gestion: { select: { id: true, anio: true } } },
      orderBy: { obligatorio: 'desc' },
    })

    res.status(200).json(conceptos)
  } catch (error) {
    console.error('[pago.getConceptosPago]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/conceptos-pago ─────────────────────────────────────────────────
export const createConceptoPago = async (req: Request, res: Response): Promise<void> => {
  const { nombre, descripcion, monto, obligatorio, gestionId, fechaVencimiento } = req.body as {
    nombre?: string
    descripcion?: string
    monto?: number
    obligatorio?: boolean
    gestionId?: number
    fechaVencimiento?: string
  }

  if (!nombre || monto === undefined || !gestionId) {
    res.status(400).json({ error: 'nombre, monto y gestionId son obligatorios' })
    return
  }

  try {
    const concepto = await prisma.conceptoPago.create({
      data: {
        nombre, descripcion, monto,
        obligatorio: obligatorio ?? true,
        gestionId,
        fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : undefined,
      },
    })
    res.status(201).json(concepto)
  } catch (error) {
    console.error('[pago.createConceptoPago]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/pagos/:inscripcionId ────────────────────────────────────────────
export const getPagosByInscripcion = async (req: Request, res: Response): Promise<void> => {
  const inscripcionId = Number(req.params.inscripcionId)

  try {
    const inscripcion = await prisma.inscripcion.findUnique({
      where: { id: inscripcionId },
      include: {
        estudiante: { select: { persona: { select: { nombre: true, apellido: true, ci: true } } } },
        curso:      { select: { nivel: true, grado: true, paralelo: true } },
        gestion:    { select: { anio: true } },
      },
    })

    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

    const conceptos = await prisma.conceptoPago.findMany({ where: { gestionId: inscripcion.gestionId } })

    const pagos = await prisma.pago.findMany({
      where: { inscripcionId },
      include: {
        conceptoPago:  { select: { nombre: true, monto: true } },
        registradoPor: { select: { username: true } },
      },
      orderBy: { fechaPago: 'desc' },
    })

    const estadoPorConcepto = conceptos.map(concepto => {
      const pagoValido = pagos.find(p => p.conceptoPagoId === concepto.id && p.estado === 'PAGADO')
      const pagosAnulados = pagos.filter(p => p.conceptoPagoId === concepto.id && p.estado === 'ANULADO')

      return {
        concepto: { id: concepto.id, nombre: concepto.nombre, monto: concepto.monto },
        obligatorio: concepto.obligatorio,
        estado:      pagoValido ? 'PAGADO' : 'PENDIENTE',
        montoPagado: pagoValido?.montoPagado ?? 0,
        fechaPago:   pagoValido?.fechaPago ?? null,
        numeroRecibo: pagoValido?.numeroRecibo ?? null,
        pagosAnulados: pagosAnulados.length,
      }
    })

    const totalRequerido = conceptos
      .filter(c => c.obligatorio)
      .reduce((sum, c) => sum + Number(c.monto), 0)

    const totalPagado = estadoPorConcepto
      .filter(e => e.estado === 'PAGADO')
      .reduce((sum, e) => sum + Number(e.montoPagado), 0)

    res.status(200).json({
      inscripcion: { ...inscripcion, estudiante: aplanarPersona(inscripcion.estudiante) },
      resumen: {
        totalRequerido,
        totalPagado,
        saldo: totalRequerido - totalPagado,
        alDia: totalRequerido <= totalPagado,
      },
      estadoPorConcepto,
      historialPagos: pagos,
    })
  } catch (error) {
    console.error('[pago.getPagosByInscripcion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/pagos ──────────────────────────────────────────────────────────
export const registrarPago = async (req: Request, res: Response): Promise<void> => {
  const { inscripcionId, conceptoPagoId, montoPagado, descuento, metodoPago, observaciones } =
    req.body as {
      inscripcionId?: number
      conceptoPagoId?: number
      montoPagado?: number
      descuento?: number
      metodoPago?: 'EFECTIVO' | 'TRANSFERENCIA' | 'QR'
      observaciones?: string
    }

  if (!inscripcionId || !conceptoPagoId || montoPagado === undefined) {
    res.status(400).json({ error: 'inscripcionId, conceptoPagoId y montoPagado son obligatorios' })
    return
  }

  try {
    const conceptoPago = await prisma.conceptoPago.findUnique({ where: { id: conceptoPagoId } })
    if (!conceptoPago) {
      res.status(404).json({ error: 'Concepto de pago no encontrado' })
      return
    }

    const pagoExistente = await prisma.pago.findFirst({
      where: { inscripcionId, conceptoPagoId, estado: 'PAGADO' },
    })
    if (pagoExistente) {
      res.status(409).json({
        error: 'Ya existe un pago activo para este concepto',
        sugerencia: 'Si deseas reemplazarlo, primero anula el pago existente',
        pagoExistente: { id: pagoExistente.id, numeroRecibo: pagoExistente.numeroRecibo },
      })
      return
    }

    const fecha    = new Date()
    const anio     = fecha.getFullYear()
    const contador = await prisma.pago.count({ where: { creadoEn: { gte: new Date(`${anio}-01-01`) } } })
    const numeroRecibo = `REC-${anio}-${String(contador + 1).padStart(4, '0')}`

    const pago = await prisma.pago.create({
      data: {
        inscripcionId,
        conceptoPagoId,
        montoOriginal:   conceptoPago.monto,
        descuento:       descuento ?? 0,
        montoPagado,
        metodoPago:      metodoPago ?? 'EFECTIVO',
        estado:          'PAGADO',
        numeroRecibo,
        observaciones,
        registradoPorId: req.user?.id,
      },
      include: {
        conceptoPago: { select: { nombre: true, monto: true } },
        inscripcion:  { include: { estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } } },
      },
    })

    res.status(201).json({ ...pago, inscripcion: { ...pago.inscripcion, estudiante: aplanarPersona(pago.inscripcion.estudiante) } })
  } catch (error) {
    console.error('[pago.registrarPago]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/pagos/:id/anular ────────────────────────────────────────────────
export const anularPago = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { observaciones } = req.body as { observaciones?: string }

  try {
    const pago = await prisma.pago.findUnique({ where: { id } })

    if (!pago) {
      res.status(404).json({ error: 'Pago no encontrado' })
      return
    }

    if (pago.estado === 'ANULADO') {
      res.status(400).json({ error: 'El pago ya está anulado' })
      return
    }

    const anulado = await prisma.pago.update({
      where: { id },
      data: {
        estado: 'ANULADO',
        observaciones: observaciones ? `ANULADO: ${observaciones}` : 'ANULADO por secretaría',
      },
    })

    res.status(200).json({ message: 'Pago anulado correctamente', pago: anulado })
  } catch (error) {
    console.error('[pago.anularPago]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}