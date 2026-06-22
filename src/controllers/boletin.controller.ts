import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearDocumento, dibujarEncabezado, dibujarPiePagina, COLORES } from '../lib/pdf.js'

// ─── GET /api/boletin/:estudianteId/:trimestreId ──────────────────────────────
// Genera el boletín PDF de un estudiante para un trimestre específico
export const generarBoletin = async (req: Request, res: Response): Promise<void> => {
  const estudianteId = Number(req.params.estudianteId)
  const trimestreId  = Number(req.params.trimestreId)

  try {
    // Verificar que el trimestre esté cerrado
    const trimestre = await prisma.trimestre.findUnique({
      where: { id: trimestreId },
      include: { gestion: true },
    })

    if (!trimestre) {
      res.status(404).json({ error: 'Trimestre no encontrado' })
      return
    }

    if (!trimestre.cerrado) {
      res.status(400).json({
        error: 'El trimestre no está cerrado — no se puede generar el boletín',
        sugerencia: 'Cierra el trimestre en POST /api/trimestres/:id/cerrar',
      })
      return
    }

    // Obtener inscripción del estudiante en la gestión del trimestre
    const inscripcion = await prisma.inscripcion.findFirst({
      where: { estudianteId, gestionId: trimestre.gestionId },
      include: {
        estudiante: true,
        curso:      true,
        gestion:    true,
        calificaciones: {
          where: { trimestreId },
          include: {
            docenteMateriaCurso: {
              include: {
                materia: true,
                docente: { select: { nombre: true, apellido: true } },
              },
            },
          },
          orderBy: {
            docenteMateriaCurso: { materia: { nombre: 'asc' } },
          },
        },
        resumenAsistencias: {
          where: { trimestreId },
          include: {
            docenteMateriaCurso: {
              include: { materia: { select: { nombre: true } } },
            },
          },
        },
      },
    })

    if (!inscripcion) {
      res.status(404).json({ error: 'El estudiante no está inscrito en esta gestión' })
      return
    }

    // Obtener tutor vinculado
    const tutorVinculo = await prisma.tutorEstudiante.findFirst({
      where: { estudianteId },
      include: {
        tutor: { select: { nombre: true, apellido: true, parentesco: true } },
      },
    })

    // ─── Generar PDF ──────────────────────────────────────────────────────────
    const doc = crearDocumento()

    // Configurar headers de respuesta
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="boletin_${inscripcion.estudiante.apellido}_T${trimestre.numero}.pdf"`
    )

    // Pipe al response
    doc.pipe(res)

    // ── Encabezado ────────────────────────────────────────────────────────────
    dibujarEncabezado(doc)

    // ── Título del boletín ────────────────────────────────────────────────────
    doc
      .fillColor(COLORES.azulOscuro)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(`BOLETÍN DE CALIFICACIONES — ${trimestre.nombre.toUpperCase()}`, {
        align: 'center',
      })
      .moveDown(0.3)

    doc
      .fillColor(COLORES.grisMedio)
      .fontSize(10)
      .font('Helvetica')
      .text(`Gestión Académica ${trimestre.gestion.anio}`, { align: 'center' })
      .moveDown(1)

    // ── Datos del estudiante ──────────────────────────────────────────────────
    const yDatos = doc.y
    doc
      .rect(50, yDatos, doc.page.width - 100, 80)
      .fill(COLORES.azulClaro)

    doc
      .fillColor(COLORES.azulOscuro)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('DATOS DEL ESTUDIANTE', 60, yDatos + 8)

    doc
      .fillColor(COLORES.grisOscuro)
      .fontSize(9)
      .font('Helvetica')

    const col1 = 60
    const col2 = 320

    doc.text(`Nombre:`, col1, yDatos + 22, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${inscripcion.estudiante.nombre} ${inscripcion.estudiante.apellido}`)

    doc.font('Helvetica')
       .text(`Carnet de Identidad:`, col1, yDatos + 36, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${inscripcion.estudiante.ci}`)

    doc.font('Helvetica')
       .text(`Curso:`, col2, yDatos + 22, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${inscripcion.curso.nombre}`)

    doc.font('Helvetica')
       .text(`Tutor/Padre:`, col2, yDatos + 36, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${tutorVinculo ? `${tutorVinculo.tutor.nombre} ${tutorVinculo.tutor.apellido}` : 'No registrado'}`)

    doc.font('Helvetica')
       .text(`Paralelo:`, col1, yDatos + 50, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${inscripcion.curso.paralelo}`)

    doc.font('Helvetica')
       .text(`Parentesco:`, col2, yDatos + 50, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${tutorVinculo?.tutor.parentesco ?? '—'}`)

    doc.y = yDatos + 90
    doc.moveDown(0.5)

    // ── Tabla de calificaciones ───────────────────────────────────────────────
    doc
      .fillColor(COLORES.azulOscuro)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('CALIFICACIONES DEL TRIMESTRE', { align: 'left' })
      .moveDown(0.3)

    const yTabla = doc.y
    const COL = {
      materia:    { x: 52,  ancho: 200 },
      docente:    { x: 255, ancho: 140 },
      nota:       { x: 398, ancho: 60  },
      asistencia: { x: 461, ancho: 70  },
      estado:     { x: 534, ancho: 60  },
    }

    // Encabezado de la tabla
    const encabezados = [
      { texto: 'MATERIA',    ...COL.materia,    alineacion: 'left'   as const },
      { texto: 'DOCENTE',    ...COL.docente,    alineacion: 'left'   as const },
      { texto: 'NOTA',       ...COL.nota,       alineacion: 'center' as const },
      { texto: '% ASIST.',   ...COL.asistencia, alineacion: 'center' as const },
      { texto: 'ESTADO',     ...COL.estado,     alineacion: 'center' as const },
    ]

    // Fondo encabezado
    doc.rect(50, yTabla, doc.page.width - 100, 22).fill(COLORES.azulOscuro)
    encabezados.forEach(col => {
      doc
        .fillColor(COLORES.blanco)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text(col.texto, col.x, yTabla + 6, {
          width: col.ancho, align: col.alineacion, lineBreak: false,
        })
    })

    // Filas de materias
    let yActual = yTabla + 22
    inscripcion.calificaciones.forEach((cal, index) => {
      const fondo = index % 2 === 0 ? COLORES.grisClaro : COLORES.blanco

      // Buscar % de asistencia de esta materia
      const resumen = inscripcion.resumenAsistencias.find(
        r => r.docenteMateriaCursoId === cal.docenteMateriaCursoId
      )
      const porcentaje = resumen ? `${resumen.porcentaje.toFixed(1)}%` : '—'
      const aprobado   = (cal.nota ?? 0) >= 51

      doc.rect(50, yActual, doc.page.width - 100, 20).fill(fondo)

      const columnas = [
        { texto: cal.docenteMateriaCurso.materia.nombre, ...COL.materia, alineacion: 'left' as const },
        { texto: `${cal.docenteMateriaCurso.docente.nombre} ${cal.docenteMateriaCurso.docente.apellido}`, ...COL.docente, alineacion: 'left' as const },
        { texto: (cal.nota ?? 0).toFixed(1), ...COL.nota, alineacion: 'center' as const },
        { texto: porcentaje, ...COL.asistencia, alineacion: 'center' as const },
        { texto: aprobado ? 'APROBADO' : 'REPROBADO', ...COL.estado, alineacion: 'center' as const },
      ]

      columnas.forEach(col => {
        const colorTexto = col.texto === 'REPROBADO' ? COLORES.rojo
          : col.texto === 'APROBADO' ? COLORES.verde
          : COLORES.grisOscuro

        doc
          .fillColor(colorTexto)
          .fontSize(9)
          .font(col.texto === 'REPROBADO' || col.texto === 'APROBADO' ? 'Helvetica-Bold' : 'Helvetica')
          .text(col.texto, col.x, yActual + 5, {
            width: col.ancho, align: col.alineacion, lineBreak: false,
          })
      })

      yActual += 20
    })

    // Fila de promedio general
    const promGeneral = inscripcion.calificaciones.length > 0
      ? inscripcion.calificaciones.reduce((sum, c) => sum + (c.nota ?? 0), 0) / inscripcion.calificaciones.length
      : 0

    doc.rect(50, yActual, doc.page.width - 100, 24).fill(COLORES.azulOscuro)
    doc
      .fillColor(COLORES.blanco)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('PROMEDIO GENERAL DEL TRIMESTRE', 52, yActual + 6, { width: 340 })
      .text(promGeneral.toFixed(2), COL.nota.x, yActual + 6, {
        width: COL.nota.ancho, align: 'center',
      })
      .text(promGeneral >= 51 ? 'APROBADO' : 'REPROBADO', COL.estado.x, yActual + 6, {
        width: COL.estado.ancho, align: 'center',
      })

    yActual += 34
    doc.y = yActual
    doc.moveDown(1)

    // ── Observaciones ─────────────────────────────────────────────────────────
    doc
      .rect(50, doc.y, doc.page.width - 100, 50)
      .stroke(COLORES.azulMedio)

    doc
      .fillColor(COLORES.azulOscuro)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('OBSERVACIONES:', 60, doc.y + 8)

    doc
      .fillColor(COLORES.grisOscuro)
      .font('Helvetica')
      .text(inscripcion.observaciones ?? '', 60, doc.y + 20, {
        width: doc.page.width - 120,
      })

    doc.y += 60
    doc.moveDown(2)

    // ── Firmas ────────────────────────────────────────────────────────────────
    const yFirmas = doc.y
    const firmas = [
      { label: 'Director/a', x: 60 },
      { label: 'Secretario/a', x: 240 },
      { label: 'Tutor/Padre de Familia', x: 420 },
    ]

    firmas.forEach(firma => {
      doc
        .moveTo(firma.x, yFirmas + 30)
        .lineTo(firma.x + 140, yFirmas + 30)
        .strokeColor(COLORES.grisOscuro)
        .lineWidth(0.5)
        .stroke()

      doc
        .fillColor(COLORES.grisMedio)
        .fontSize(8)
        .font('Helvetica')
        .text(firma.label, firma.x, yFirmas + 35, { width: 140, align: 'center' })
    })

    // ── Pie de página ─────────────────────────────────────────────────────────
    dibujarPiePagina(doc, 1)

    doc.end()
  } catch (error) {
    console.error('[boletin.generarBoletin]', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar el boletín' })
    }
  }
}

// ─── GET /api/boletin/curso/:cursoId/:trimestreId ─────────────────────────────
// Genera boletines de TODOS los estudiantes del curso en un solo PDF
export const generarBoletinesCurso = async (req: Request, res: Response): Promise<void> => {
  const cursoId     = Number(req.params.cursoId)
  const trimestreId = Number(req.params.trimestreId)

  try {
    const trimestre = await prisma.trimestre.findUnique({
      where: { id: trimestreId },
      include: { gestion: true },
    })

    if (!trimestre?.cerrado) {
      res.status(400).json({ error: 'El trimestre no está cerrado' })
      return
    }

    // Obtener todas las inscripciones del curso
    const inscripciones = await prisma.inscripcion.findMany({
      where: { cursoId, gestionId: trimestre.gestionId },
      include: {
        estudiante: true,
        curso:      true,
        calificaciones: {
          where: { trimestreId },
          include: {
            docenteMateriaCurso: {
              include: { materia: true, docente: true },
            },
          },
          orderBy: { docenteMateriaCurso: { materia: { nombre: 'asc' } } },
        },
        resumenAsistencias: {
          where: { trimestreId },
          include: {
            docenteMateriaCurso: {
              include: { materia: { select: { nombre: true } } },
            },
          },
        },
      },
      orderBy: { estudiante: { apellido: 'asc' } },
    })

    if (inscripciones.length === 0) {
      res.status(404).json({ error: 'No hay estudiantes inscritos en este curso' })
      return
    }

    const curso = inscripciones[0].curso

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="boletines_${curso.nivel.replace(/ /g, '_')}_T${trimestre.numero}.pdf"`
    )

    const doc = crearDocumento()
    doc.pipe(res)

    // Generar un boletín por estudiante
    inscripciones.forEach((insc, idx) => {
      if (idx > 0) doc.addPage()

      dibujarEncabezado(doc)

      doc
        .fillColor(COLORES.azulOscuro)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text(`BOLETÍN — ${trimestre.nombre.toUpperCase()} — ${trimestre.gestion.anio}`, {
          align: 'center',
        })
        .moveDown(0.5)

      // Nombre del estudiante destacado
      doc
        .rect(50, doc.y, doc.page.width - 100, 28)
        .fill(COLORES.azulClaro)

      doc
        .fillColor(COLORES.azulOscuro)
        .fontSize(11)
        .font('Helvetica-Bold')
        .text(
          `${insc.estudiante.apellido}, ${insc.estudiante.nombre} — ${insc.curso.nombre}`,
          60, doc.y + 8,
          { width: doc.page.width - 120 }
        )

      doc.y += 36
      doc.moveDown(0.5)

      // Tabla simplificada
      const yT = doc.y
      doc.rect(50, yT, doc.page.width - 100, 20).fill(COLORES.azulOscuro)

      const cols = [
        { label: 'MATERIA',  x: 52,  w: 220 },
        { label: 'T1',       x: 275, w: 50  },
        { label: 'T2',       x: 328, w: 50  },
        { label: 'T3',       x: 381, w: 50  },
        { label: 'PROMEDIO', x: 434, w: 70  },
        { label: '% ASIST.', x: 507, w: 55  },
      ]

      cols.forEach(col => {
        doc.fillColor(COLORES.blanco).fontSize(8).font('Helvetica-Bold')
           .text(col.label, col.x, yT + 6, { width: col.w, align: 'center', lineBreak: false })
      })

      let yFila = yT + 20
      insc.calificaciones.forEach((cal, i) => {
        const fondo = i % 2 === 0 ? COLORES.grisClaro : COLORES.blanco
        doc.rect(50, yFila, doc.page.width - 100, 18).fill(fondo)

        const resumen = insc.resumenAsistencias.find(
          r => r.docenteMateriaCursoId === cal.docenteMateriaCursoId
        )

        const datos = [
          { texto: cal.docenteMateriaCurso.materia.nombre, x: 52,  w: 220, align: 'left'   as const },
          { texto: '—',                                    x: 275, w: 50,  align: 'center' as const },
          { texto: '—',                                    x: 328, w: 50,  align: 'center' as const },
          { texto: (cal.nota ?? 0).toFixed(1),             x: 381, w: 50,  align: 'center' as const },
          { texto: (cal.nota ?? 0).toFixed(1),             x: 434, w: 70,  align: 'center' as const },
          { texto: resumen ? `${resumen.porcentaje.toFixed(0)}%` : '—', x: 507, w: 55, align: 'center' as const },
        ]

        datos.forEach(d => {
          doc.fillColor(COLORES.grisOscuro).fontSize(8).font('Helvetica')
             .text(d.texto, d.x, yFila + 4, { width: d.w, align: d.align, lineBreak: false })
        })

        yFila += 18
      })

      dibujarPiePagina(doc, idx + 1)
    })

    doc.end()
  } catch (error) {
    console.error('[boletin.generarBoletinesCurso]', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar los boletines' })
    }
  }
}