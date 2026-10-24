// src/services/recibo.service.ts
//
// Recibo de pago en PDF: una hoja A4 con DOS ejemplares iguales (ORIGINAL para quien paga,
// COPIA para la institución). Todos los datos salen del pago ya guardado, así que reimprimirlo
// siempre da el mismo documento. Un pago anulado se imprime con la marca "ANULADO".
//
// Es un comprobante INTERNO de la unidad educativa; no reemplaza a una factura fiscal.
import { prisma } from '../lib/prisma.js'
import { institucionActual } from '../lib/institucion.helper.js'
import { calcularDeuda } from '../lib/pago.helper.js'
import { montoEnLetras } from '../lib/monto-letras.js'
import { crearDocumento, COLORES } from '../lib/pdf.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'
import { ErrorDeUsuario } from '../lib/errores.js'

const bs = (n: number) => `Bs. ${n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fechaCorta = (d: Date) => d.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const horaLocal = (d: Date) => d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' })
const METODO: Record<string, string> = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia bancaria', QR: 'Pago QR' }
const nombreCompleto = (p?: { nombre: string; apellido: string } | null) => (p ? `${p.nombre} ${p.apellido}` : '')

export interface DatosRecibo {
  numero: string
  fechaPago: Date
  emitidoEn: Date
  anulado: boolean
  estudiante: string
  ci: string
  rude: string
  curso: string
  gestion: number
  tutor: string
  concepto: string
  descripcion: string
  montoConcepto: number
  descuento: number
  montoPagado: number
  saldo: number
  saldoEstado: string
  metodo: string
  observaciones: string
  cajero: string
  /** Abonos anteriores vigentes del mismo concepto (constancia del historial). */
  abonosPrevios: { recibo: string; fecha: Date; monto: number }[]
}

export async function obtenerDatosRecibo(pagoId: number): Promise<DatosRecibo> {
  const pago = await prisma.pago.findUnique({
    where: { id: pagoId },
    include: {
      conceptoPago: true,
      registradoPor: { select: { username: true, secretaria: { select: { persona: true } }, director: { select: { persona: true } } } },
      inscripcion: {
        include: {
          curso: true,
          gestion: { select: { anio: true } },
          estudiante: {
            select: {
              rude: true, persona: true,
              tutores: { orderBy: [{ esTutorPrincipal: 'desc' }, { id: 'asc' }], take: 1, select: { tutor: { select: { persona: true } } } },
            },
          },
        },
      },
    },
  })
  if (!pago) throw new ErrorDeUsuario('Pago no encontrado', 404)
  if (!pago.numeroRecibo) throw new ErrorDeUsuario('Este pago no tiene número de recibo', 409)

  // Saldo del concepto DESPUÉS de este abono: se suman los abonos vigentes hasta este (id ≤).
  const hasta = await prisma.pago.findMany({
    where: { inscripcionId: pago.inscripcionId, conceptoPagoId: pago.conceptoPagoId, estado: { not: 'ANULADO' }, id: { lte: pago.id } },
    orderBy: { id: 'asc' },
    select: { id: true, numeroRecibo: true, fechaPago: true, estado: true, montoOriginal: true, descuento: true, montoPagado: true },
  })
  const deuda = calcularDeuda(pago.conceptoPago.monto, hasta)

  const insc = pago.inscripcion
  const cajeroPersona = pago.registradoPor?.secretaria?.persona ?? pago.registradoPor?.director?.persona
  return {
    numero: pago.numeroRecibo,
    fechaPago: pago.fechaPago,
    emitidoEn: pago.creadoEn,
    anulado: pago.estado === 'ANULADO',
    estudiante: nombreCompleto(insc.estudiante.persona),
    ci: insc.estudiante.persona.ci ?? '—',
    rude: insc.estudiante.rude ?? '—',
    curso: `${insc.curso.grado}° "${insc.curso.paralelo}" ${NIVEL_TEXTO[insc.curso.nivel] ?? insc.curso.nivel}`,
    gestion: insc.gestion.anio,
    tutor: nombreCompleto(insc.estudiante.tutores[0]?.tutor.persona) || '—',
    concepto: pago.conceptoPago.nombre,
    descripcion: pago.conceptoPago.descripcion ?? '',
    montoConcepto: Number(pago.montoOriginal),
    descuento: Number(pago.descuento),
    montoPagado: Number(pago.montoPagado),
    saldo: deuda.saldo,
    saldoEstado: pago.estado === 'ANULADO' ? 'Pago anulado' : deuda.saldo === 0 ? 'Concepto cancelado' : 'Saldo pendiente',
    metodo: METODO[pago.metodoPago] ?? pago.metodoPago,
    observaciones: pago.observaciones ?? '',
    abonosPrevios: hasta.filter(h => h.id !== pago.id && Number(h.montoPagado) > 0).map(h => ({ recibo: h.numeroRecibo ?? '—', fecha: h.fechaPago, monto: Number(h.montoPagado) })),
    cajero: cajeroPersona ? nombreCompleto(cajeroPersona) : (pago.registradoPor?.username ?? '—'),
  }
}

// ─── Dibujo de UN ejemplar (alto ≈ 370 pt) ───────────────────────────────────
function dibujarEjemplar(doc: PDFKit.PDFDocument, d: DatosRecibo, y0: number, etiqueta: string) {
  const x0 = 40, ancho = doc.page.width - 80
  const inst = institucionActual()
  const azul = COLORES.azulOscuro

  // Marco
  doc.roundedRect(x0, y0, ancho, 372, 4).lineWidth(0.8).strokeColor(azul).stroke()

  // Cabecera institucional + caja de número
  doc.fillColor(azul).font('Helvetica-Bold').fontSize(8).text('UNIDAD EDUCATIVA', x0 + 12, y0 + 12, { width: ancho - 190 })
  const nombreInst = inst.nombre.replace(/["“”]/g, '').trim().toUpperCase()   // el nombre ya puede traer comillas
  doc.fontSize(nombreInst.length > 38 ? 11 : 13).text(`"${nombreInst}"`, x0 + 12, y0 + 23, { width: ancho - 190 })
  const ubic = [inst.direccion, [inst.municipio, inst.departamento].filter(Boolean).join(', ')].filter(Boolean).join(' — ')
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORES.grisMedio)
    .text([ubic, inst.rue ? `RUE: ${inst.rue}` : '', inst.telefono ? `Tel: ${inst.telefono}` : ''].filter(Boolean).join(' | '), x0 + 12, y0 + 50, { width: ancho - 190 })

  const bx = x0 + ancho - 168
  doc.roundedRect(bx, y0 + 10, 156, 52, 3).lineWidth(1).strokeColor(azul).stroke()
  doc.fillColor(azul).font('Helvetica-Bold').fontSize(10).text('RECIBO DE PAGO', bx, y0 + 16, { width: 156, align: 'center' })
  doc.fillColor(d.anulado ? COLORES.rojo : COLORES.grisOscuro).fontSize(14).text(`N° ${d.numero}`, bx, y0 + 31, { width: 156, align: 'center' })
  doc.font('Helvetica').fontSize(7).fillColor(COLORES.grisMedio).text(etiqueta, bx, y0 + 51, { width: 156, align: 'center' })

  doc.moveTo(x0 + 12, y0 + 70).lineTo(x0 + ancho - 12, y0 + 70).lineWidth(1.5).strokeColor(COLORES.azulMedio).stroke()

  // Datos en dos columnas
  const fila = (y: number, a: [string, string], b?: [string, string]) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORES.grisMedio).text(a[0], x0 + 12, y, { width: 70 })
    doc.font('Helvetica').fontSize(9).fillColor(COLORES.grisOscuro).text(a[1], x0 + 82, y - 1, { width: ancho / 2 - 90, lineBreak: false, ellipsis: true })
    if (b) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORES.grisMedio).text(b[0], x0 + ancho / 2 + 6, y, { width: 70 })
      doc.font('Helvetica').fontSize(9).fillColor(COLORES.grisOscuro).text(b[1], x0 + ancho / 2 + 76, y - 1, { width: ancho / 2 - 90, lineBreak: false, ellipsis: true })
    }
  }
  let y = y0 + 80
  fila(y, ['Fecha de pago', fechaCorta(d.fechaPago)], ['Emitido', `${fechaCorta(d.emitidoEn)} ${horaLocal(d.emitidoEn)}`]); y += 15
  fila(y, ['Recibí de', d.tutor === '—' ? d.estudiante : d.tutor], ['Estudiante', d.estudiante]); y += 15
  fila(y, ['CI estudiante', d.ci], ['RUDE', d.rude]); y += 15
  fila(y, ['Curso', d.curso], ['Gestión', String(d.gestion)]); y += 20

  // Tabla de detalle
  const th = y
  doc.rect(x0 + 12, th, ancho - 24, 16).fill(COLORES.azulClaro)
  doc.fillColor(azul).font('Helvetica-Bold').fontSize(8)
  doc.text('CONCEPTO', x0 + 18, th + 4, { width: ancho - 250 })
  doc.text('MONTO', x0 + ancho - 232, th + 4, { width: 62, align: 'right' })
  doc.text('DESCUENTO', x0 + ancho - 166, th + 4, { width: 62, align: 'right' })
  doc.text('PAGADO', x0 + ancho - 100, th + 4, { width: 82, align: 'right' })
  const tr = th + 22
  doc.fillColor(COLORES.grisOscuro).font('Helvetica').fontSize(9).text(d.concepto, x0 + 18, tr, { width: ancho - 250 })
  if (d.descripcion) doc.fontSize(7.5).fillColor(COLORES.grisMedio).text(d.descripcion, x0 + 18, tr + 12, { width: ancho - 250, lineBreak: false, ellipsis: true })
  doc.fontSize(9).fillColor(COLORES.grisOscuro)
  doc.text(bs(d.montoConcepto), x0 + ancho - 232, tr, { width: 62, align: 'right' })
  doc.text(bs(d.descuento), x0 + ancho - 166, tr, { width: 62, align: 'right' })
  doc.font('Helvetica-Bold').text(bs(d.montoPagado), x0 + ancho - 100, tr, { width: 82, align: 'right' })
  doc.moveTo(x0 + 12, tr + 28).lineTo(x0 + ancho - 12, tr + 28).lineWidth(0.5).strokeColor('#BBBBBB').stroke()

  // Total, método y saldo
  const ty = tr + 36
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORES.grisMedio).text('Método de pago', x0 + 12, ty, { width: 80 })
  doc.font('Helvetica').fontSize(9).fillColor(COLORES.grisOscuro).text(d.metodo, x0 + 92, ty - 1)
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORES.grisMedio).text(d.saldoEstado, x0 + 12, ty + 15, { width: 120 })
  doc.font('Helvetica-Bold').fontSize(9).fillColor(d.saldo > 0 ? COLORES.rojo : COLORES.verde).text(d.anulado ? '—' : d.saldo > 0 ? bs(d.saldo) : 'Bs. 0,00', x0 + 132, ty + 14)

  const tx = x0 + ancho - 190
  doc.rect(tx, ty - 4, 178, 34).fill(azul)
  doc.fillColor(COLORES.blanco).font('Helvetica-Bold').fontSize(8).text('TOTAL PAGADO', tx + 10, ty + 2)
  doc.fontSize(14).text(bs(d.montoPagado), tx + 10, ty + 12, { width: 160, align: 'right' })

  // Monto en letras + observaciones
  const ly = ty + 42
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORES.grisMedio).text('Son:', x0 + 12, ly, { width: 24 })
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORES.grisOscuro).text(montoEnLetras(d.montoPagado), x0 + 38, ly, { width: ancho - 60 })
  let oy = ly + 20
  if (d.abonosPrevios.length) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORES.grisMedio).text('Abonos anteriores de este concepto:', x0 + 12, oy)
    oy += 11
    const visibles = d.abonosPrevios.slice(-3)
    if (d.abonosPrevios.length > visibles.length) { doc.font('Helvetica').text(`… y ${d.abonosPrevios.length - visibles.length} abono(s) más`, x0 + 20, oy); oy += 10 }
    for (const a of visibles) {
      doc.font('Helvetica').fontSize(7.5).fillColor(COLORES.grisOscuro).text(`${a.recibo}  ·  ${fechaCorta(a.fecha)}  ·  ${bs(a.monto)}`, x0 + 20, oy)
      oy += 10
    }
    oy += 2
  }
  if (d.observaciones) {
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORES.grisMedio).text(`Obs.: ${d.observaciones}`, x0 + 12, oy, { width: ancho - 24, height: 22, ellipsis: true })
  }

  // Firmas
  const fy = y0 + 328
  for (const [i, t] of [`Cajero(a): ${d.cajero}`, 'Recibí conforme (pagador)'].entries()) {
    const fx = x0 + 30 + i * (ancho / 2)
    doc.moveTo(fx, fy).lineTo(fx + ancho / 2 - 60, fy).lineWidth(0.6).strokeColor(COLORES.grisOscuro).stroke()
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORES.grisMedio).text(t, fx, fy + 3, { width: ancho / 2 - 60, align: 'center' })
  }
  doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(COLORES.grisMedio)
    .text('Comprobante interno de la unidad educativa; no constituye factura. Consérvelo como constancia de su pago.', x0 + 12, y0 + 356, { width: ancho - 24, align: 'center' })

  if (d.anulado) {
    doc.save()
    doc.rotate(-18, { origin: [x0 + ancho / 2, y0 + 190] })
    doc.font('Helvetica-Bold').fontSize(64).fillColor(COLORES.rojo).fillOpacity(0.18)
      .text('ANULADO', x0, y0 + 160, { width: ancho, align: 'center', lineBreak: false })
    doc.restore()
    doc.fillOpacity(1)
  }
}

export function generarReciboPdf(d: DatosRecibo): PDFKit.PDFDocument {
  const doc = crearDocumento()
  doc.info.Title = `Recibo ${d.numero}`
  // Dos ejemplares llenan la hoja: sin margen inferior para que pdfkit no abra una página nueva al escribir cerca del borde
  doc.page.margins.bottom = 0
  dibujarEjemplar(doc, d, 30, 'ORIGINAL — pagador')
  // Línea de corte
  const yc = 30 + 372 + 22
  doc.dash(4, { space: 3 }).moveTo(30, yc).lineTo(doc.page.width - 30, yc).lineWidth(0.5).strokeColor('#999999').stroke().undash()
  doc.font('Helvetica').fontSize(6.5).fillColor('#999999').text('✂ cortar aquí', 40, yc - 8, { lineBreak: false })
  dibujarEjemplar(doc, d, yc + 20, 'COPIA — institución')
  return doc
}