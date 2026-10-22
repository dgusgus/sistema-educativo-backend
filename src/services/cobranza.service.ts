// src/services/cobranza.service.ts
//
// Control de cobranza: cruza TODOS los estudiantes inscritos con los conceptos obligatorios del
// periodo y responde "cuánto se esperaba, cuánto se cobró, quién debe y desde cuándo".
// Solo LEE; no escribe nada. Las reglas de cuenta están en lib/cobranza.ts.
//
// Consultas: 5 en total, sin importar cuántos estudiantes haya (pagos y conceptos se traen una vez).

import { prisma } from '../lib/prisma.js'
import { ErrorDeUsuario, NoEncontrado } from '../lib/errores.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'
import {
  conceptoEnPeriodo, deudasDeInscripcion, hoyBolivia, sumarDeudas,
  type ConceptoCobranza, type DeudaDeConcepto, type TotalesCobranza, type TrimestrePeriodo,
} from '../lib/cobranza.js'

const fechaTexto = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export interface FiltroCobranza {
  gestionId?: number
  trimestreId?: number
  cursoId?: number
  conceptoId?: number
}

export interface DeudorCobranza {
  inscripcionId: number
  estudiante: string
  ci: string
  cursoId: number
  curso: string
  /** Tutor principal (o el primero con teléfono) para llamar o escribir */
  contacto: { nombre: string; telefono: string }
  saldo: number
  vencido: number
  maxDiasMora: number
  /** Fecha límite más próxima entre lo que debe ("AAAA-MM-DD"); null si sus conceptos no tienen fecha */
  proximoVencimiento: string | null
  pendientes: Array<{ conceptoId: number; nombre: string; saldo: number; fechaVencimiento: string | null; vencido: boolean; diasMora: number }>
}

export interface AlDiaCobranza { inscripcionId: number; estudiante: string; cursoId: number; curso: string; pagado: number }

export interface FilaCurso extends TotalesCobranza {
  cursoId: number
  curso: string
  estudiantes: number
  deudores: number
}

export interface CeldaMatriz { estado: 'PAGADO' | 'PARCIAL' | 'PENDIENTE'; pagado: number; saldo: number; vencido: boolean }

export interface Cobranza {
  gestion: { id: number; anio: number }
  periodo: { trimestreId: number | null; nombre: string }
  hoy: string
  conceptos: Array<{ id: number; nombre: string; monto: number; fechaVencimiento: string | null; trimestreId: number | null }>
  kpis: TotalesCobranza & { estudiantes: number; deudores: number; morosos: number; alDia: number }
  porCurso: FilaCurso[]
  deudores: DeudorCobranza[]
  /** Estudiantes sin saldo en el periodo (pagaron todo lo que corresponde) */
  alDia: AlDiaCobranza[]
  /** Solo cuando se filtra por un curso: estudiantes × conceptos */
  matriz: Array<{ inscripcionId: number; estudiante: string; celdas: Record<number, CeldaMatriz> }> | null
}

export async function obtenerCobranza(filtro: FiltroCobranza): Promise<Cobranza> {
  const gestion = filtro.gestionId
    ? await prisma.gestion.findUnique({ where: { id: filtro.gestionId }, select: { id: true, anio: true } })
    : await prisma.gestion.findFirst({ where: { activa: true }, select: { id: true, anio: true } })
  if (!gestion) throw new NoEncontrado('Gestión')

  let trimestre: (TrimestrePeriodo & { nombre: string }) | null = null
  if (filtro.trimestreId) {
    const t = await prisma.trimestre.findUnique({ where: { id: filtro.trimestreId } })
    if (!t || t.gestionId !== gestion.id) throw new ErrorDeUsuario('El trimestre no pertenece a esta gestión')
    trimestre = { id: t.id, nombre: t.nombre, fechaInicio: fechaTexto(t.fechaInicio)!, fechaFin: fechaTexto(t.fechaFin)! }
  }

  const [conceptosDb, inscripciones] = await Promise.all([
    prisma.conceptoPago.findMany({
      where: { gestionId: gestion.id, activo: true, obligatorio: true, ...(filtro.conceptoId ? { id: filtro.conceptoId } : {}) },
      orderBy: [{ fechaVencimiento: 'asc' }, { id: 'asc' }],
    }),
    prisma.inscripcion.findMany({
      where: { gestionId: gestion.id, estadoInscripcion: 'ACTIVA', ...(filtro.cursoId ? { cursoId: filtro.cursoId } : {}) },
      select: {
        id: true, cursoId: true,
        curso: { select: { nivel: true, grado: true, paralelo: true } },
        estudiante: {
          select: {
            persona: { select: { nombre: true, apellido: true, ci: true, telefono: true } },
            tutores: {
              select: {
                esTutorPrincipal: true,
                tutor: { select: { persona: { select: { nombre: true, apellido: true, telefono: true } } } },
              },
            },
          },
        },
      },
      orderBy: [{ curso: { nivel: 'asc' } }, { curso: { grado: 'asc' } }, { curso: { paralelo: 'asc' } },
                { estudiante: { persona: { apellido: 'asc' } } }],
    }),
  ])

  const conceptos: ConceptoCobranza[] = conceptosDb
    .map(c => ({ id: c.id, nombre: c.nombre, monto: Number(c.monto), fechaVencimiento: fechaTexto(c.fechaVencimiento), trimestreId: c.trimestreId }))
    .filter(c => conceptoEnPeriodo(c, trimestre))

  const pagos = conceptos.length && inscripciones.length
    ? await prisma.pago.findMany({
        where: { inscripcionId: { in: inscripciones.map(i => i.id) }, conceptoPagoId: { in: conceptos.map(c => c.id) }, estado: { not: 'ANULADO' } },
        select: { id: true, inscripcionId: true, conceptoPagoId: true, estado: true, montoOriginal: true, descuento: true, montoPagado: true },
      })
    : []
  const pagosDe = new Map<number, typeof pagos>()
  for (const p of pagos) (pagosDe.get(p.inscripcionId) ?? pagosDe.set(p.inscripcionId, []).get(p.inscripcionId)!).push(p)

  const hoy = hoyBolivia()
  const todas: DeudaDeConcepto[] = []
  const deudores: DeudorCobranza[] = []
  const alDia: AlDiaCobranza[] = []
  const cursos = new Map<number, { nombre: string; deudas: DeudaDeConcepto[]; estudiantes: number; deudores: number }>()
  const matriz: NonNullable<Cobranza['matriz']> = []

  for (const insc of inscripciones) {
    const deudas = deudasDeInscripcion(conceptos, pagosDe.get(insc.id) ?? [], hoy)
    todas.push(...deudas)

    const nombreCurso = `${insc.curso.grado}° ${NIVEL_TEXTO[insc.curso.nivel]} "${insc.curso.paralelo}"`
    const c = cursos.get(insc.cursoId) ?? cursos.set(insc.cursoId, { nombre: nombreCurso, deudas: [], estudiantes: 0, deudores: 0 }).get(insc.cursoId)!
    c.deudas.push(...deudas); c.estudiantes++

    const p = insc.estudiante.persona
    const nombre = `${p.apellido} ${p.nombre}`
    const pendientes = deudas.filter(d => d.saldo > 0)
    if (pendientes.length > 0) {
      c.deudores++
      const tutores = insc.estudiante.tutores
      const t = tutores.find(x => x.esTutorPrincipal && x.tutor.persona.telefono) ?? tutores.find(x => x.tutor.persona.telefono) ?? tutores[0]
      deudores.push({
        inscripcionId: insc.id, estudiante: nombre, ci: p.ci ?? '', cursoId: insc.cursoId, curso: nombreCurso,
        contacto: t ? { nombre: `${t.tutor.persona.nombre} ${t.tutor.persona.apellido}`, telefono: t.tutor.persona.telefono ?? '' } : { nombre: '', telefono: p.telefono ?? '' },
        saldo: sumarDeudas(pendientes).porCobrar,
        vencido: sumarDeudas(pendientes).vencido,
        maxDiasMora: Math.max(0, ...pendientes.map(d => d.diasMora)),
        proximoVencimiento: pendientes.map(d => d.fechaVencimiento).filter((f): f is string => f !== null).sort()[0] ?? null,
        pendientes: pendientes.map(d => ({ conceptoId: d.conceptoId, nombre: d.nombre, saldo: d.saldo, fechaVencimiento: d.fechaVencimiento, vencido: d.vencido, diasMora: d.diasMora })),
      })
    } else if (deudas.length > 0) {
      alDia.push({ inscripcionId: insc.id, estudiante: nombre, cursoId: insc.cursoId, curso: nombreCurso, pagado: sumarDeudas(deudas).recaudado })
    }

    if (filtro.cursoId) {
      const celdas: Record<number, CeldaMatriz> = {}
      for (const d of deudas) celdas[d.conceptoId] = { estado: d.estado, pagado: d.pagado, saldo: d.saldo, vencido: d.vencido }
      matriz.push({ inscripcionId: insc.id, estudiante: nombre, celdas })
    }
  }

  // Más urgentes primero: mayor deuda vencida, luego mayor saldo
  deudores.sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo || a.estudiante.localeCompare(b.estudiante))

  const morosos = deudores.filter(d => d.vencido > 0).length
  return {
    gestion,
    periodo: { trimestreId: trimestre?.id ?? null, nombre: trimestre?.nombre ?? 'Toda la gestión' },
    hoy,
    conceptos: conceptos.map(c => ({ id: c.id, nombre: c.nombre, monto: c.monto, fechaVencimiento: c.fechaVencimiento, trimestreId: c.trimestreId })),
    kpis: {
      ...sumarDeudas(todas),
      estudiantes: inscripciones.length, deudores: deudores.length, morosos, alDia: inscripciones.length - deudores.length,
    },
    porCurso: [...cursos.entries()].map(([cursoId, c]) => ({
      cursoId, curso: c.nombre, estudiantes: c.estudiantes, deudores: c.deudores, ...sumarDeudas(c.deudas),
    })),
    deudores,
    alDia,
    matriz: filtro.cursoId ? matriz : null,
  }
}

// ─── Pagos recibidos (lo que ya se cobró) ────────────────────────────────────

export interface FiltroPagosRecibidos {
  gestionId?: number
  cursoId?: number
  conceptoId?: number
  metodo?: 'EFECTIVO' | 'TRANSFERENCIA' | 'QR'
  /** "AAAA-MM-DD" */
  desde?: string
  hasta?: string
  incluirAnulados?: boolean
}

const LIMITE_PAGOS = 1000

export async function obtenerPagosRecibidos(f: FiltroPagosRecibidos) {
  const gestion = f.gestionId
    ? await prisma.gestion.findUnique({ where: { id: f.gestionId }, select: { id: true, anio: true } })
    : await prisma.gestion.findFirst({ where: { activa: true }, select: { id: true, anio: true } })
  if (!gestion) throw new NoEncontrado('Gestión')

  const where = {
    inscripcion: { gestionId: gestion.id, ...(f.cursoId ? { cursoId: f.cursoId } : {}) },
    ...(f.conceptoId ? { conceptoPagoId: f.conceptoId } : {}),
    ...(f.metodo ? { metodoPago: f.metodo } : {}),
    ...(f.incluirAnulados ? {} : { estado: { not: 'ANULADO' as const } }),
    ...((f.desde || f.hasta) ? { fechaPago: { ...(f.desde ? { gte: new Date(f.desde) } : {}), ...(f.hasta ? { lte: new Date(f.hasta) } : {}) } } : {}),
  }

  const [filas, total] = await Promise.all([
    prisma.pago.findMany({
      where, take: LIMITE_PAGOS,
      orderBy: [{ fechaPago: 'desc' }, { id: 'desc' }],
      select: {
        id: true, numeroRecibo: true, fechaPago: true, metodoPago: true, estado: true,
        montoPagado: true, descuento: true, observaciones: true,
        conceptoPago: { select: { nombre: true } },
        registradoPor: { select: { username: true } },
        inscripcion: { select: { curso: { select: { nivel: true, grado: true, paralelo: true } }, estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } } },
      },
    }),
    prisma.pago.count({ where }),
  ])

  const pagos = filas.map(p => ({
    id: p.id, numeroRecibo: p.numeroRecibo, fecha: fechaTexto(p.fechaPago)!, metodo: p.metodoPago, estado: p.estado,
    monto: Number(p.montoPagado), concepto: p.conceptoPago.nombre, cajero: p.registradoPor?.username ?? '',
    estudiante: `${p.inscripcion.estudiante.persona.apellido} ${p.inscripcion.estudiante.persona.nombre}`,
    curso: `${p.inscripcion.curso.grado}° ${NIVEL_TEXTO[p.inscripcion.curso.nivel]} "${p.inscripcion.curso.paralelo}"`,
    observaciones: p.observaciones,
  }))

  // Los totales se calculan sobre TODOS los pagos del filtro (no solo las 1000 filas mostradas)
  const grupos = await prisma.pago.groupBy({
    by: ['metodoPago'], where: { ...where, estado: { not: 'ANULADO' } }, _sum: { montoPagado: true }, _count: true,
  })
  const porMetodo: Record<string, { monto: number; cantidad: number }> = {}
  let monto = 0, cantidad = 0
  for (const g of grupos) {
    const m = Number(g._sum.montoPagado ?? 0)
    porMetodo[g.metodoPago] = { monto: m, cantidad: g._count }
    monto += m; cantidad += g._count
  }

  return { gestion, pagos, truncado: total > LIMITE_PAGOS, totales: { monto, cantidad, porMetodo } }
}

/** Estudiantes con deuda VENCIDA en toda la gestión activa (indicador del dashboard y del menú). */
export async function contarMorosos(gestionId?: number): Promise<number> {
  const c = await obtenerCobranza({ gestionId })
  return c.kpis.morosos
}
