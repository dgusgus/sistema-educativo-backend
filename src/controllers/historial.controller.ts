import { Request, Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { miEstudianteId, puedeVerEstudiante } from '../lib/ownership.helper.js'
import { obtenerHistorialEstudiante } from '../services/historial.service.js'
import { crearDocumento, dibujarEncabezado, dibujarPiePagina, COLORES } from '../lib/pdf.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'
import { institucionActual } from '../lib/institucion.helper.js'

// Valida el id, el permiso (admin, el propio estudiante o su tutor) y carga el historial.
async function cargar(req: Request, res: Response, estudianteId: number) {
  if (!Number.isInteger(estudianteId) || estudianteId <= 0) {
    res.status(400).json({ error: 'estudianteId inválido' })
    return null
  }
  if (!(await puedeVerEstudiante(req, estudianteId))) {
    res.status(403).json({ error: 'Sin permisos para ver el historial de este estudiante' })
    return null
  }
  const h = await obtenerHistorialEstudiante(estudianteId)
  if (!h) {
    res.status(404).json({ error: 'Estudiante no encontrado' })
    return null
  }
  return h
}

// GET /api/historial/mio — el estudiante autenticado ve el suyo
export const getMiHistorial = asyncHandler(async (req, res) => {
  const id = await miEstudianteId(req)
  if (id === null) {
    res.status(404).json({ error: 'Tu cuenta no tiene un perfil de estudiante vinculado. Contacta a secretaría.' })
    return
  }
  const h = await cargar(req, res, id)
  if (h) res.json(h)
})

// GET /api/historial/:estudianteId
export const getHistorial = asyncHandler(async (req, res) => {
  const h = await cargar(req, res, Number(req.params.estudianteId))
  if (h) res.json(h)
})

// GET /api/historial/:estudianteId/pdf — certificado de calificaciones
export const getHistorialPdf = asyncHandler(async (req, res) => {
  const h = await cargar(req, res, Number(req.params.estudianteId))
  if (!h) return
  if (h.gestiones.length === 0) {
    res.status(404).json({ error: 'El estudiante aún no tiene gestiones registradas' })
    return
  }

  const nombreCompleto = `${h.estudiante.nombre} ${h.estudiante.apellido}`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="historial_${h.estudiante.apellido.replace(/[^\w-]+/g, '_')}.pdf"`)

  const doc = crearDocumento()
  doc.pipe(res)
  const ancho = doc.page.width - 100
  let pagina = 1
  const limiteY = () => doc.page.height - 80

  const nuevaPagina = () => {
    dibujarPiePagina(doc, pagina)
    doc.addPage()
    pagina++
    doc.y = 50
  }
  // Pie de página + "doc.page.margins.bottom" no debe disparar saltos automáticos
  doc.page.margins.bottom = 0

  dibujarEncabezado(doc)
  doc.fillColor(COLORES.azulOscuro).fontSize(13).font('Helvetica-Bold')
     .text('HISTORIAL ACADÉMICO — CERTIFICADO DE CALIFICACIONES', 50, doc.y, { align: 'center', width: ancho })
     .moveDown(0.5)

  const yDatos = doc.y
  doc.rect(50, yDatos, ancho, 46).fill(COLORES.azulClaro)
  doc.fillColor(COLORES.azulOscuro).fontSize(9).font('Helvetica-Bold').text('DATOS DEL ESTUDIANTE', 60, yDatos + 7)
  doc.fillColor(COLORES.grisOscuro).font('Helvetica')
  doc.text('Nombre:', 60, yDatos + 22, { continued: true }).font('Helvetica-Bold').text(` ${nombreCompleto}`)
  doc.font('Helvetica').text('CI:', 330, yDatos + 22, { continued: true }).font('Helvetica-Bold').text(` ${h.estudiante.ci}`)
  doc.font('Helvetica').text('RUDE:', 330, yDatos + 33, { continued: true }).font('Helvetica-Bold').text(` ${h.estudiante.rude ?? '—'}`)
  doc.y = yDatos + 56

  const nota = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(0))

  for (const g of h.gestiones) {
    const alto = 18 + 20 + g.materias.length * 15 + 22 + 26
    if (doc.y + alto > limiteY()) nuevaPagina()

    const curso = `${NIVEL_TEXTO[g.curso.nivel as keyof typeof NIVEL_TEXTO] ?? g.curso.nivel} ${g.curso.grado}° "${g.curso.paralelo}"`
    let y = doc.y
    doc.rect(50, y, ancho, 18).fill(COLORES.azulMedio)
    doc.fillColor(COLORES.blanco).fontSize(9).font('Helvetica-Bold')
       .text(`GESTIÓN ${g.anio} — ${curso}`, 56, y + 5, { lineBreak: false })
    const colRes = g.resultado === 'REPROBADO' ? 'REPROBADO' : g.resultado === 'PROMOVIDO' ? 'PROMOVIDO' : g.estadoInscripcion === 'RETIRADA' ? 'RETIRADO' : 'EN CURSO'
    doc.text(colRes, 50, y + 5, { width: ancho - 6, align: 'right', lineBreak: false })
    y += 18

    const anchoTrim = 48
    const x = {
      materia: 52,
      t: g.trimestres.map((_, i) => 262 + i * anchoTrim),
      anual: 262 + g.trimestres.length * anchoTrim,
    }
    doc.rect(50, y, ancho, 16).fill(COLORES.azulOscuro)
    doc.fillColor(COLORES.blanco).fontSize(7.5).font('Helvetica-Bold').text('MATERIA', x.materia, y + 5, { lineBreak: false })
    g.trimestres.forEach((t, i) => doc.text(`T${t.numero}`, x.t[i], y + 5, { width: anchoTrim, align: 'center', lineBreak: false }))
    doc.text('ANUAL', x.anual, y + 5, { width: 55, align: 'center', lineBreak: false })
    y += 16

    g.materias.forEach((m, idx) => {
      doc.rect(50, y, ancho, 15).fill(idx % 2 === 0 ? COLORES.grisClaro : COLORES.blanco)
      doc.fillColor(COLORES.grisOscuro).fontSize(8).font('Helvetica')
         .text(m.materia, x.materia, y + 4, { width: 205, lineBreak: false, ellipsis: true })
      g.trimestres.forEach((t, i) => doc.text(nota(m.notas[t.id]), x.t[i], y + 4, { width: anchoTrim, align: 'center', lineBreak: false }))
      doc.fillColor(m.resultado === 'REPROBADO' ? COLORES.rojo : COLORES.grisOscuro).font('Helvetica-Bold')
         .text(nota(m.promedioFinal), x.anual, y + 4, { width: 55, align: 'center', lineBreak: false })
      y += 15
    })

    doc.rect(50, y, ancho, 18).fill(COLORES.azulClaro)
    doc.fillColor(COLORES.azulOscuro).fontSize(8.5).font('Helvetica-Bold').text('PROMEDIO GENERAL', x.materia, y + 5, { lineBreak: false })
    g.trimestres.forEach((t, i) => doc.text(nota(g.promedioPorTrimestre[t.id]), x.t[i], y + 5, { width: anchoTrim, align: 'center', lineBreak: false }))
    doc.text(g.promedioAnual === null ? '—' : g.promedioAnual.toFixed(2), x.anual, y + 5, { width: 55, align: 'center', lineBreak: false })
    y += 18
    doc.fillColor(COLORES.grisMedio).fontSize(7.5).font('Helvetica')
       .text(`Asistencia general: ${g.asistenciaGeneral === null ? '—' : g.asistenciaGeneral.toFixed(1) + '%'}   ·   Nota mínima de aprobación: ${g.notaMinima}`, 52, y + 3, { lineBreak: false })
    doc.y = y + 18
  }

  // Firmas
  if (doc.y + 70 > limiteY()) nuevaPagina()
  const yF = doc.y + 25
  ;[{ l: 'Director/a', x: 80 }, { l: 'Secretario/a', x: 360 }].forEach(f => {
    doc.moveTo(f.x, yF).lineTo(f.x + 150, yF).strokeColor(COLORES.grisOscuro).lineWidth(0.5).stroke()
    doc.fillColor(COLORES.grisMedio).fontSize(8).font('Helvetica').text(f.l, f.x, yF + 5, { width: 150, align: 'center' })
  })
  doc.fillColor(COLORES.grisMedio).fontSize(7.5)
     .text(`Documento emitido por ${institucionActual().nombre} el ${new Date().toLocaleDateString('es-BO')}.`, 50, yF + 28, { width: ancho, align: 'center' })

  dibujarPiePagina(doc, pagina)
  doc.end()
})