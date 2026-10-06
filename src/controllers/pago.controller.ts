import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'
import { Prisma } from '../../prisma/generated/prisma/client.js'
import { aCentavos, calcularDeuda, recalcularEstadosDeuda } from '../lib/pago.helper.js'

const METODOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'QR'] as const
type MetodoPagoValido = typeof METODOS_PAGO[number]

// Clave del "candado" de PostgreSQL que serializa el registro de pagos.
// Cualquier número fijo sirve; solo debe ser único dentro de esta app.
const LOCK_REGISTRO_PAGOS = 7301001

// Acepta número o texto numérico ("100.50"), rechaza NaN/Infinity/vacío,
// y redondea a 2 decimales (la columna es Decimal(10,2)).
function aDinero(valor: unknown): number | null {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

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

    // La deuda de cada concepto suma TODOS sus abonos (antes solo se miraba el primer pago PAGADO,
    // así un pago parcial nunca se veía y el concepto seguía "pendiente" con 0 pagado).
    const estadoPorConcepto = conceptos.map(concepto => {
      const delConcepto   = pagos.filter(p => p.conceptoPagoId === concepto.id)
      const deuda         = calcularDeuda(concepto.monto, [...delConcepto].sort((a, b) => a.id - b.id))
      const abonos        = delConcepto.filter(p => p.estado !== 'ANULADO' && aCentavos(p.montoPagado) > 0).sort((a, b) => b.id - a.id)
      const pagosAnulados = delConcepto.filter(p => p.estado === 'ANULADO')

      return {
        concepto: { id: concepto.id, nombre: concepto.nombre, monto: concepto.monto },
        obligatorio:  concepto.obligatorio,
        estado:       deuda.estado,            // PAGADO | PARCIAL | PENDIENTE
        montoPagado:  deuda.pagado,            // total abonado
        descuento:    deuda.descuento,
        saldo:        deuda.saldo,             // lo que falta de ESTE concepto (ya descontado)
        abonos:       deuda.abonos,
        fechaPago:    abonos[0]?.fechaPago ?? null,        // del último abono
        numeroRecibo: abonos[0]?.numeroRecibo ?? null,
        pagosAnulados: pagosAnulados.length,
      }
    })

    // Solo cuentan los conceptos OBLIGATORIOS (antes totalPagado sumaba también los opcionales:
    // pagar un uniforme opcional podía marcar "al día" a quien no pagó la matrícula) y el saldo
    // respeta los descuentos (antes un alumno con descuento figuraba con deuda para siempre).
    const obligatorios   = estadoPorConcepto.filter(e => e.obligatorio)
    const totalRequerido = obligatorios.reduce((sum, e) => sum + Number(e.concepto.monto), 0)
    const totalPagado    = obligatorios.reduce((sum, e) => sum + e.montoPagado, 0)
    const saldoTotal     = obligatorios.reduce((sum, e) => sum + e.saldo, 0)

    res.status(200).json({
      inscripcion: { ...inscripcion, estudiante: aplanarPersona(inscripcion.estudiante) },
      resumen: {
        totalRequerido,
        totalPagado,
        saldo: saldoTotal,
        alDia: saldoTotal <= 0,
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
//
// Por qué ahora va dentro de una transacción con candado:
//  Antes: (1) se comprobaba "¿ya pagó?", (2) se contaban los pagos del año y se
//  sumaba 1 para el número de recibo, (3) se creaba. Entre esos pasos otro
//  cobro podía colarse: dos recibos con el mismo número (el segundo fallaba con
//  500) o, con doble clic, el mismo concepto cobrado dos veces.
//  Ahora el candado hace que los cobros se procesen de a uno: la comprobación,
//  el número de recibo y la creación ocurren como un solo paso indivisible.
type ResultadoPago =
  | { ok: true; saldoPendiente: number; pago: Prisma.PagoGetPayload<{ include: {
      conceptoPago: { select: { nombre: true; monto: true } }
      inscripcion:  { include: { estudiante: { select: { persona: { select: { nombre: true; apellido: true } } } } } }
    } }> }
  | { ok: false; status: number; body: Record<string, unknown> }

export const registrarPago = async (req: Request, res: Response): Promise<void> => {
  const { inscripcionId, conceptoPagoId, montoPagado, descuento, metodoPago, observaciones } =
    req.body as {
      inscripcionId?: number
      conceptoPagoId?: number
      montoPagado?: number | string
      descuento?: number | string
      metodoPago?: string
      observaciones?: string
    }

  if (inscripcionId === undefined || conceptoPagoId === undefined || montoPagado === undefined) {
    res.status(400).json({ error: 'inscripcionId, conceptoPagoId y montoPagado son obligatorios' })
    return
  }
  if (!Number.isInteger(inscripcionId) || inscripcionId <= 0 || !Number.isInteger(conceptoPagoId) || conceptoPagoId <= 0) {
    res.status(400).json({ error: 'inscripcionId y conceptoPagoId deben ser números enteros válidos' })
    return
  }

  const monto = aDinero(montoPagado)
  if (monto === null || monto <= 0 || monto > 99_999_999.99) {
    res.status(400).json({ error: 'montoPagado debe ser un número mayor a 0' })
    return
  }

  const desc = descuento === undefined ? 0 : aDinero(descuento)
  if (desc === null || desc < 0) {
    res.status(400).json({ error: 'descuento debe ser un número mayor o igual a 0' })
    return
  }

  if (metodoPago !== undefined && !METODOS_PAGO.includes(metodoPago as MetodoPagoValido)) {
    res.status(400).json({ error: `metodoPago debe ser uno de: ${METODOS_PAGO.join(', ')}` })
    return
  }
  if (observaciones !== undefined && (typeof observaciones !== 'string' || observaciones.length > 500)) {
    res.status(400).json({ error: 'observaciones debe ser texto de hasta 500 caracteres' })
    return
  }

  try {
    const [conceptoPago, inscripcion] = await Promise.all([
      prisma.conceptoPago.findUnique({ where: { id: conceptoPagoId } }),
      prisma.inscripcion.findUnique({ where: { id: inscripcionId }, select: { id: true, gestionId: true } }),
    ])
    if (!conceptoPago) {
      res.status(404).json({ error: 'Concepto de pago no encontrado' })
      return
    }
    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }
    if (!conceptoPago.activo) {
      res.status(400).json({ error: 'El concepto de pago está inactivo' })
      return
    }
    // Un concepto de la gestión 2025 no se cobra a una inscripción 2026.
    if (conceptoPago.gestionId !== inscripcion.gestionId) {
      res.status(400).json({ error: 'El concepto de pago no corresponde a la gestión de esta inscripción' })
      return
    }
    if (desc > Number(conceptoPago.monto)) {
      res.status(400).json({ error: 'El descuento no puede ser mayor al monto del concepto' })
      return
    }

    const resultado = await prisma.$transaction(async (tx): Promise<ResultadoPago> => {
      // Se libera solo al terminar la transacción.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_REGISTRO_PAGOS})`

      // Deuda actual de este concepto (todos los abonos NO anulados)
      const previos = await tx.pago.findMany({
        where:   { inscripcionId, conceptoPagoId, estado: { not: 'ANULADO' } },
        orderBy: { id: 'asc' },
      })
      const antes = calcularDeuda(conceptoPago.monto, previos)

      if (antes.estado === 'PAGADO') {
        const ultimo = [...previos].reverse().find(p => aCentavos(p.montoPagado) > 0)
        return {
          ok: false,
          status: 409,
          body: {
            error: 'Este concepto ya está pagado por completo',
            sugerencia: 'Si el pago fue un error, anúlalo primero y vuelve a registrarlo',
            pagoExistente: ultimo ? { id: ultimo.id, numeroRecibo: ultimo.numeroRecibo } : null,
          },
        }
      }

      // El abono no puede superar lo que falta por pagar
      const saldoDespues = aCentavos(antes.saldo) - aCentavos(desc) - aCentavos(monto)
      if (saldoDespues < 0) {
        return {
          ok: false,
          status: 400,
          body: {
            error: `El monto excede el saldo pendiente de este concepto (Bs. ${antes.saldo.toFixed(2)})`,
            saldoPendiente: antes.saldo,
          },
        }
      }

      // Siguiente número = el MAYOR del año + 1 (no "cuántos hay + 1", que se
      // descuadra si hay saltos). Se compara como número, no como texto, para
      // que siga bien pasado el REC-AAAA-9999.
      const anio    = new Date().getFullYear()
      const prefijo = `REC-${anio}-`
      const filas = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(SUBSTRING("numeroRecibo" FROM ${prefijo.length + 1}::int) AS INTEGER)) AS max
        FROM "Pago"
        WHERE "numeroRecibo" ~ ${'^' + prefijo + '[0-9]+$'}`
      const numeroRecibo = `${prefijo}${String((filas[0]?.max ?? 0) + 1).padStart(4, '0')}`

      const pago = await tx.pago.create({
        data: {
          inscripcionId,
          conceptoPagoId,
          // Monto de referencia de la deuda: el del primer pago real (no cambia si luego editan el concepto)
          montoOriginal:   antes.abonos > 0 ? antes.montoOriginal : conceptoPago.monto,
          descuento:       desc,
          montoPagado:     monto,
          metodoPago:      (metodoPago as MetodoPagoValido | undefined) ?? 'EFECTIVO',
          estado:          saldoDespues === 0 ? 'PAGADO' : 'PARCIAL',
          numeroRecibo,
          observaciones,
          registradoPorId: req.user?.id,
        },
        include: {
          conceptoPago: { select: { nombre: true, monto: true } },
          inscripcion:  { include: { estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } } },
        },
      })
      // Si este abono cerró la deuda, los abonos anteriores (PARCIAL) pasan a PAGADO
      await recalcularEstadosDeuda(tx, inscripcionId, conceptoPagoId, conceptoPago.monto)
      return { ok: true, pago, saldoPendiente: saldoDespues / 100 }
    }, { timeout: 10_000 })

    if (!resultado.ok) {
      res.status(resultado.status).json(resultado.body)
      return
    }

    const { pago, saldoPendiente } = resultado
    res.status(201).json({ ...pago, saldoPendiente, inscripcion: { ...pago.inscripcion, estudiante: aplanarPersona(pago.inscripcion.estudiante) } })
  } catch (error) {
    console.error('[pago.registrarPago]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/pagos/:id/anular ────────────────────────────────────────────────
export const anularPago = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { observaciones } = req.body as { observaciones?: string }

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'id de pago inválido' })
    return
  }
  if (observaciones !== undefined && (typeof observaciones !== 'string' || observaciones.length > 500)) {
    res.status(400).json({ error: 'observaciones debe ser texto de hasta 500 caracteres' })
    return
  }

  try {
    const pago = await prisma.pago.findUnique({ where: { id } })

    if (!pago) {
      res.status(404).json({ error: 'Pago no encontrado' })
      return
    }

    // Se conserva lo que ya decía el pago y se deja constancia de QUIÉN y
    // CUÁNDO lo anuló (antes la nota original se pisaba y no quedaba rastro).
    const fecha  = new Date().toISOString().slice(0, 10)
    const motivo = observaciones?.trim() || 'sin motivo indicado'
    const nota   = `ANULADO por ${req.user!.username} el ${fecha}: ${motivo}`
    const textoNuevo = pago.observaciones ? `${pago.observaciones} | ${nota}` : nota

    // Mismo candado que registrarPago: anular y recalcular no pueden cruzarse con un cobro.
    // Condicional y atómico: si dos personas anulan a la vez, solo una gana. Al anular un
    // abono, los demás se recalculan (p. ej. el que cerraba la deuda → vuelve a PARCIAL).
    const anulado0 = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_REGISTRO_PAGOS})`
      const { count } = await tx.pago.updateMany({
        where: { id, estado: { not: 'ANULADO' } },
        data:  { estado: 'ANULADO', observaciones: textoNuevo },
      })
      if (count === 0) return false
      const concepto = await tx.conceptoPago.findUnique({ where: { id: pago.conceptoPagoId }, select: { monto: true } })
      await recalcularEstadosDeuda(tx, pago.inscripcionId, pago.conceptoPagoId, concepto?.monto ?? pago.montoOriginal)
      return true
    }, { timeout: 10_000 })
    if (!anulado0) {
      res.status(400).json({ error: 'El pago ya está anulado' })
      return
    }

    const anulado = await prisma.pago.findUnique({ where: { id } })
    res.status(200).json({ message: 'Pago anulado correctamente', pago: anulado })
  } catch (error) {
    console.error('[pago.anularPago]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}