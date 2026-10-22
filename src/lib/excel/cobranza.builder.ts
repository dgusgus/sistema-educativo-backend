// src/lib/excel/cobranza.builder.ts
//
// Excel del control de cobranza: hoja "Resumen" (por curso) y hoja "Deudores" (para llamar o
// imprimir). Solo dibuja lo que calcula services/cobranza.service.ts.

import ExcelJS from 'exceljs'
import type { Cobranza } from '../../services/cobranza.service.js'
import { COLOR, bordear, configurarImpresion, fusionar, poner } from './estilos.js'

const BS = '#,##0.00'

export async function construirExcelCobranza(c: Cobranza, nombreColegio: string): Promise<Buffer> {
  const libro = new ExcelJS.Workbook()
  libro.creator = 'Sistema Web de Gestión Académica'
  libro.created = new Date()

  const cab = { negrita: true, color: COLOR.blanco, fondo: COLOR.azulOscuro, borde: true } as const
  const titulo = (h: ExcelJS.Worksheet, texto: string, ult: number) => {
    fusionar(h, 1, 1, 1, ult)
    poner(h, 1, 1, texto, { tamano: 14, negrita: true, color: COLOR.azulOscuro })
    h.getRow(1).height = 26
    fusionar(h, 2, 1, 2, ult)
    poner(h, 2, 1, `${nombreColegio}  |  Gestión ${c.gestion.anio}  |  ${c.periodo.nombre}  |  al ${c.hoy}`, {
      alineacion: 'left', color: COLOR.grisMedio, ajustar: false,
    })
  }

  // ── Resumen por curso ──
  const r = libro.addWorksheet('Resumen')
  ;[34, 12, 14, 14, 14, 14, 12, 12].forEach((w, i) => { r.getColumn(i + 1).width = w })
  configurarImpresion(r, { vertical: true })
  titulo(r, 'CONTROL DE COBRANZA - RESUMEN', 8)
  ;['CURSO', 'ESTUDIANTES', 'ESPERADO (Bs)', 'COBRADO (Bs)', 'POR COBRAR (Bs)', 'VENCIDO (Bs)', '% COBRADO', 'CON DEUDA']
    .forEach((t, i) => poner(r, 4, i + 1, t, cab))
  r.getRow(4).height = 30
  const filas = [...c.porCurso, { cursoId: 0, curso: 'TOTAL', ...c.kpis }]
  filas.forEach((f, i) => {
    const total = f.cursoId === 0
    const base = { borde: true, negrita: total, fondo: total ? COLOR.azulClaro : undefined } as const
    const fila = 5 + i
    poner(r, fila, 1, f.curso, { ...base, alineacion: 'left' })
    poner(r, fila, 2, f.estudiantes, base)
    poner(r, fila, 3, f.esperado, { ...base, formato: BS })
    poner(r, fila, 4, f.recaudado, { ...base, formato: BS })
    poner(r, fila, 5, f.porCobrar, { ...base, formato: BS })
    poner(r, fila, 6, f.vencido, { ...base, formato: BS, color: f.vencido > 0 ? COLOR.rojo : undefined })
    poner(r, fila, 7, f.porcentajeCobrado, { ...base, formato: '0.0"%"' })
    poner(r, fila, 8, f.deudores, base)
  })
  r.views = [{ showGridLines: false, state: 'frozen', ySplit: 4 }]

  // ── Deudores ──
  const d = libro.addWorksheet('Deudores')
  ;[5, 36, 28, 28, 16, 14, 14, 10, 14, 60].forEach((w, i) => { d.getColumn(i + 1).width = w })
  configurarImpresion(d, { filasRepetidas: '4:4' })
  titulo(d, 'DEUDORES', 10)
  ;['Nº', 'ESTUDIANTE', 'CURSO', 'TUTOR', 'TELÉFONO', 'SALDO (Bs)', 'VENCIDO (Bs)', 'DÍAS MORA', 'VENCE', 'CONCEPTOS ADEUDADOS']
    .forEach((t, i) => poner(d, 4, i + 1, t, cab))
  d.getRow(4).height = 30
  c.deudores.forEach((x, i) => {
    const fila = 5 + i
    const base = { borde: true, ajustar: false, fondo: i % 2 === 1 ? COLOR.azulClaro : undefined } as const
    poner(d, fila, 1, i + 1, base)
    poner(d, fila, 2, x.estudiante, { ...base, alineacion: 'left' })
    poner(d, fila, 3, x.curso, { ...base, alineacion: 'left' })
    poner(d, fila, 4, x.contacto.nombre, { ...base, alineacion: 'left' })
    poner(d, fila, 5, x.contacto.telefono, base).numFmt = '@'
    poner(d, fila, 6, x.saldo, { ...base, formato: BS, negrita: true })
    poner(d, fila, 7, x.vencido, { ...base, formato: BS, color: x.vencido > 0 ? COLOR.rojo : undefined })
    poner(d, fila, 8, x.maxDiasMora > 0 ? x.maxDiasMora : null, base)
    poner(d, fila, 9, x.proximoVencimiento, base)
    poner(d, fila, 10, x.pendientes.map(p => `${p.nombre} (Bs ${p.saldo.toFixed(2)})`).join(' · '), { ...base, alineacion: 'left' })
  })
  if (c.deudores.length === 0) {
    fusionar(d, 5, 1, 5, 10)
    poner(d, 5, 1, 'Nadie tiene deudas en este periodo.', { color: COLOR.verde, negrita: true })
  } else {
    bordear(d, 4, 1, 4, 10)
  }
  d.views = [{ showGridLines: false, state: 'frozen', ySplit: 4 }]

  return Buffer.from(await libro.xlsx.writeBuffer())
}
