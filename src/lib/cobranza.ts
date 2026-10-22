// src/lib/cobranza.ts
//
// Reglas PURAS del control de cobranza (sin base de datos): qué conceptos entran en un periodo,
// cuánto debe cada estudiante, qué está vencido y cuántos días de atraso lleva, y el generador de
// cuotas (pensión mensual / trimestral).
//
// ¿Para qué? La pantalla de pagos solo mostraba un estudiante a la vez. Para saber "quién debe" hay
// que cruzar TODOS los estudiantes con TODOS los conceptos del periodo. Esa cuenta vive aquí, una vez,
// y la usan el resumen, los deudores, la matriz por curso, el Excel y el indicador del dashboard.
//
// La deuda de cada (estudiante + concepto) se calcula con calcularDeuda() de pago.helper.ts, la misma
// regla de siempre: así esta pantalla y la de cobro nunca muestran saldos distintos.

import { aCentavos, calcularDeuda, type EstadoDeuda, type PagoParaDeuda } from './pago.helper.js'

export interface ConceptoCobranza {
  id: number
  nombre: string
  monto: number
  /** "AAAA-MM-DD" */
  fechaVencimiento: string | null
  trimestreId: number | null
}

export interface TrimestrePeriodo { id: number; fechaInicio: string; fechaFin: string }

/** ¿Este concepto pertenece al periodo? Sin periodo elegido entran todos. */
export function conceptoEnPeriodo(c: ConceptoCobranza, trimestre: TrimestrePeriodo | null): boolean {
  if (!trimestre) return true
  if (c.trimestreId !== null) return c.trimestreId === trimestre.id
  if (c.fechaVencimiento) return c.fechaVencimiento >= trimestre.fechaInicio && c.fechaVencimiento <= trimestre.fechaFin
  return false
}

/** Hoy en Bolivia (UTC-4) como "AAAA-MM-DD": después de las 20:00 hora local, UTC ya cambió de día. */
export function hoyBolivia(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 4 * 3600_000).toISOString().slice(0, 10)
}

/** Días entre dos fechas "AAAA-MM-DD" (hasta − desde). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

export interface DeudaDeConcepto {
  conceptoId: number
  nombre: string
  fechaVencimiento: string | null
  /** lo que correspondía cobrar, ya descontado */
  esperado: number
  pagado: number
  saldo: number
  estado: EstadoDeuda
  /** con saldo y pasada la fecha de vencimiento */
  vencido: boolean
  diasMora: number
}

/** Deuda de UNA inscripción en cada concepto. `pagos` = pagos NO anulados de esa inscripción (cualquier orden). */
export function deudasDeInscripcion(
  conceptos: ConceptoCobranza[],
  pagos: Array<PagoParaDeuda & { conceptoPagoId: number; id: number }>,
  hoy: string,
): DeudaDeConcepto[] {
  return conceptos.map(c => {
    const delConcepto = pagos.filter(p => p.conceptoPagoId === c.id).sort((a, b) => a.id - b.id)
    const d = calcularDeuda(c.monto, delConcepto)
    const vencido = d.saldo > 0 && c.fechaVencimiento !== null && c.fechaVencimiento < hoy
    return {
      conceptoId: c.id, nombre: c.nombre, fechaVencimiento: c.fechaVencimiento,
      esperado: (aCentavos(d.montoOriginal) - aCentavos(d.descuento)) / 100,
      pagado: d.pagado, saldo: d.saldo, estado: d.estado,
      vencido, diasMora: vencido ? diasEntre(c.fechaVencimiento!, hoy) : 0,
    }
  })
}

export interface TotalesCobranza {
  esperado: number
  recaudado: number
  porCobrar: number
  vencido: number
  /** % del esperado ya cobrado (0–100, 1 decimal); null si no hay nada esperado */
  porcentajeCobrado: number | null
}

export function sumarDeudas(deudas: DeudaDeConcepto[]): TotalesCobranza {
  let esperado = 0, recaudado = 0, porCobrar = 0, vencido = 0
  for (const d of deudas) {
    esperado += aCentavos(d.esperado); recaudado += aCentavos(d.pagado); porCobrar += aCentavos(d.saldo)
    if (d.vencido) vencido += aCentavos(d.saldo)
  }
  return {
    esperado: esperado / 100, recaudado: recaudado / 100, porCobrar: porCobrar / 100, vencido: vencido / 100,
    porcentajeCobrado: esperado > 0 ? Math.round((recaudado * 1000) / esperado) / 10 : null,
  }
}

// ─── Generador de cuotas ─────────────────────────────────────────────────────

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export interface CuotaGenerada {
  nombre: string
  fechaVencimiento: string
  trimestreId: number | null
  periodicidad: 'MENSUAL' | 'TRIMESTRAL'
}

const pad = (n: number) => String(n).padStart(2, '0')
const ultimoDia = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate()

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)
}

/** Cuotas MENSUALES: una por mes entre mesDesde y mesHasta; vence el `diaVencimiento` (o el último día si el mes es más corto). */
export function generarCuotasMensuales(
  nombreBase: string, anio: number, mesDesde: number, mesHasta: number, diaVencimiento: number,
  trimestres: TrimestrePeriodo[],
): CuotaGenerada[] {
  const cuotas: CuotaGenerada[] = []
  for (let mes = mesDesde; mes <= mesHasta; mes++) {
    const fecha = `${anio}-${pad(mes)}-${pad(Math.min(diaVencimiento, ultimoDia(anio, mes)))}`
    const t = trimestres.find(x => fecha >= x.fechaInicio && fecha <= x.fechaFin)
    cuotas.push({ nombre: `${nombreBase} ${MESES[mes]}`, fechaVencimiento: fecha, trimestreId: t?.id ?? null, periodicidad: 'MENSUAL' })
  }
  return cuotas
}

/** Cuotas TRIMESTRALES: una por trimestre; vence `diasPlazo` después de que empieza (sin pasar del fin del trimestre). */
export function generarCuotasTrimestrales(
  nombreBase: string, trimestres: Array<TrimestrePeriodo & { nombre: string }>, diasPlazo: number,
): CuotaGenerada[] {
  return trimestres.map(t => {
    const vence = sumarDias(t.fechaInicio, diasPlazo)
    return {
      nombre: `${nombreBase} ${t.nombre}`,
      fechaVencimiento: vence > t.fechaFin ? t.fechaFin : vence,
      trimestreId: t.id, periodicidad: 'TRIMESTRAL' as const,
    }
  })
}
