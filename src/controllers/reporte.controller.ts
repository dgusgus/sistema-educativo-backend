import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearDocumento, dibujarEncabezado, dibujarPiePagina, COLORES } from '../lib/pdf.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'

// ─── GET /api/dashboard ───────────────────────────────────────────────────────
export const getDashboard = async (_req: Request, res: Response): Promise<void> => {
  try {
    const gestion = await prisma.gestion.findFirst({ where: { activa: true } })
    if (!gestion) {
      res.status(404).json({ error: 'No hay gestión activa' })
      return
    }
    const notaMinima = Number(gestion.notaMinimaAprobacion)

    const totalEstudiantes = await prisma.inscripcion.count({ where: { gestionId: gestion.id } })
    const totalDocentes    = await prisma.docente.count({ where: { activo: true } })
    const totalCursos      = await prisma.curso.count({ where: { gestionId: gestion.id } })

    // Antes: _avg de Calificacion.nota — ahora es promedioTrimestral
    const promedioCalificaciones = await prisma.calificacion.aggregate({
      where: { docenteMateriaCurso: { gestionId: gestion.id } },
      _avg: { promedioTrimestral: true },
    })

    const promedioAsistencia = await prisma.resumenAsistencia.aggregate({
      where: { docenteMateriaCurso: { gestionId: gestion.id } },
      _avg: { porcentaje: true },
    })

    const estudiantesEnRiesgo = await prisma.resumenAsistencia.groupBy({
      by: ['inscripcionId'],
      where: { docenteMateriaCurso: { gestionId: gestion.id }, porcentaje: { lt: 80 } },
      _count: true,
    })

    // Antes: umbral fijo 51 — ahora Gestion.notaMinimaAprobacion
    const bajosRendimiento = await prisma.promedioFinal.groupBy({
      by: ['inscripcionId'],
      where: { docenteMateriaCurso: { gestionId: gestion.id }, promedioFinal: { lt: notaMinima } },
      _count: true,
    })

    const totalRecaudado = await prisma.pago.aggregate({
      where: { estado: 'PAGADO', inscripcion: { gestionId: gestion.id } },
      _sum: { montoPagado: true },
    })

    const pagosPendientes = await prisma.pago.count({
      where: { estado: 'PENDIENTE', inscripcion: { gestionId: gestion.id } },
    })

    const trimestres = await prisma.trimestre.findMany({
      where: { gestionId: gestion.id },
      select: { numero: true, nombre: true, cerrado: true },
      orderBy: { numero: 'asc' },
    })

    res.status(200).json({
      gestion: { id: gestion.id, anio: gestion.anio },
      indicadores: {
        totalEstudiantes,
        totalDocentes,
        totalCursos,
        promedioGeneral:     Number(promedioCalificaciones._avg.promedioTrimestral?.toFixed(2) ?? 0),
        promedioAsistencia:  Number(promedioAsistencia._avg.porcentaje?.toFixed(2) ?? 0),
        estudiantesEnRiesgo: estudiantesEnRiesgo.length,
        bajosRendimiento:    bajosRendimiento.length,
        totalRecaudado:      Number(totalRecaudado._sum.montoPagado ?? 0),
        pagosPendientes,
      },
      trimestres,
      generadoEn: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[reporte.getDashboard]', error)
    res.status(500).json({ error: 'Error al obtener el dashboard' })
  }
}

// ─── GET /api/reportes/academico ──────────────────────────────────────────────
export const getReporteAcademico = async (req: Request, res: Response): Promise<void> => {
  const { gestionId, cursoId, materiaId, trimestreId } = req.query as {
    gestionId?:   string
    cursoId?:     string
    materiaId?:   string
    trimestreId?: string
  }

  if (!gestionId) {
    res.status(400).json({ error: 'gestionId es obligatorio' })
    return
  }

  try {
    const inscripciones = await prisma.inscripcion.findMany({
      where: {
        gestionId: Number(gestionId),
        ...(cursoId && { cursoId: Number(cursoId) }),
      },
      include: {
        estudiante: { select: { persona: { select: { nombre: true, apellido: true, ci: true } } } },
        curso:      { select: { nivel: true, grado: true, paralelo: true } },
        calificaciones: {
          where: {
            ...(materiaId   && { docenteMateriaCurso: { materiaId: Number(materiaId) } }),
            ...(trimestreId && { trimestreId: Number(trimestreId) }),
          },
          include: {
            docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } },
            trimestre: { select: { numero: true, nombre: true } },
          },
        },
        promediosFinales: {
          where: { ...(materiaId && { docenteMateriaCurso: { materiaId: Number(materiaId) } }) },
          include: { docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } } },
        },
        resumenAsistencias: {
          where: { ...(trimestreId && { trimestreId: Number(trimestreId) }) },
          include: { docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } } },
        },
      },
      orderBy: [{ curso: { nivel: 'asc' } }, { estudiante: { persona: { apellido: 'asc' } } }],
    })

    // Antes: c.nota — ahora c.promedioTrimestral (puede ser null si aún no se calculó)
    const todasLasNotas = inscripciones.flatMap(i =>
      i.calificaciones.filter(c => c.promedioTrimestral !== null).map(c => Number(c.promedioTrimestral))
    )
    const promedio = todasLasNotas.length
      ? todasLasNotas.reduce((a, b) => a + b, 0) / todasLasNotas.length
      : 0

    // Antes: p.aprobado (boolean) — ahora p.resultado (enum)
    const aprobados = inscripciones.filter(i =>
      i.promediosFinales.length > 0 && i.promediosFinales.every(p => p.resultado === 'PROMOVIDO')
    ).length

    res.status(200).json({
      filtros: { gestionId, cursoId, materiaId, trimestreId },
      estadisticas: {
        totalEstudiantes: inscripciones.length,
        promedioGeneral:  Number(promedio.toFixed(2)),
        aprobados,
        reprobados:       inscripciones.length - aprobados,
        tasaAprobacion:   inscripciones.length ? Number(((aprobados / inscripciones.length) * 100).toFixed(1)) : 0,
      },
      detalle: inscripciones.map(i => ({ ...i, estudiante: aplanarPersona(i.estudiante) })),
    })
  } catch (error) {
    console.error('[reporte.getReporteAcademico]', error)
    res.status(500).json({ error: 'Error al generar el reporte' })
  }
}

// ─── GET /api/reportes/academico/pdf ─────────────────────────────────────────
export const getReporteAcademicoPDF = async (req: Request, res: Response): Promise<void> => {
  const { gestionId, cursoId } = req.query as {
    gestionId?: string
    cursoId?:   string
  }

  if (!gestionId) {
    res.status(400).json({ error: 'gestionId es obligatorio' })
    return
  }

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id: Number(gestionId) } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }
    const notaMinima = Number(gestion.notaMinimaAprobacion)

    const inscripciones = await prisma.inscripcion.findMany({
      where: {
        gestionId: Number(gestionId),
        ...(cursoId && { cursoId: Number(cursoId) }),
      },
      include: {
        estudiante: { select: { persona: { select: { nombre: true, apellido: true, ci: true } } } },
        curso:      { select: { nivel: true, grado: true, paralelo: true } },
        promediosFinales: {
          include: { docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } } },
        },
        resumenAsistencias: true,
      },
      orderBy: [{ curso: { nivel: 'asc' } }, { estudiante: { persona: { apellido: 'asc' } } }],
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="reporte_academico_${gestion.anio}.pdf"`)

    const doc = crearDocumento()
    doc.pipe(res)

    dibujarEncabezado(doc)

    doc.fillColor(COLORES.azulOscuro).fontSize(13).font('Helvetica-Bold')
       .text(`REPORTE ACADÉMICO — GESTIÓN ${gestion.anio}`, { align: 'center' })
       .moveDown(0.5)

    doc.fillColor(COLORES.grisMedio).fontSize(9).font('Helvetica')
       .text(`Generado el ${new Date().toLocaleDateString('es-BO')}`, { align: 'center' })
       .moveDown(1)

    const yT = doc.y
    const cols = [
      { label: 'N°',          x: 52,  w: 25  },
      { label: 'ESTUDIANTE',  x: 80,  w: 170 },
      { label: 'CURSO',       x: 253, w: 100 },
      { label: 'PROM. FINAL', x: 356, w: 70  },
      { label: '% ASIST.',    x: 429, w: 60  },
      { label: 'RESULTADO',   x: 492, w: 70  },
    ]

    doc.rect(50, yT, doc.page.width - 100, 22).fill(COLORES.azulOscuro)
    cols.forEach(col => {
      doc.fillColor(COLORES.blanco).fontSize(8).font('Helvetica-Bold')
         .text(col.label, col.x, yT + 6, { width: col.w, align: 'center', lineBreak: false })
    })

    let yFila = yT + 22
    let aprobados = 0

    inscripciones.forEach((insc, i) => {
      const promedios = insc.promediosFinales.map(p => Number(p.promedioFinal))
      const promGeneral = promedios.length ? promedios.reduce((a, b) => a + b, 0) / promedios.length : 0

      const porcentajes = insc.resumenAsistencias.map(r => Number(r.porcentaje))
      const porcGeneral = porcentajes.length ? porcentajes.reduce((a, b) => a + b, 0) / porcentajes.length : 0

      const aprobado = promGeneral >= notaMinima
      if (aprobado) aprobados++

      const fondo = i % 2 === 0 ? COLORES.grisClaro : COLORES.blanco
      doc.rect(50, yFila, doc.page.width - 100, 18).fill(fondo)

      const nombreCurso = `${insc.curso.grado}° ${NIVEL_TEXTO[insc.curso.nivel]} "${insc.curso.paralelo}"`

      const datos = [
        { texto: String(i + 1), x: 52,  w: 25,  align: 'center' as const },
        { texto: `${insc.estudiante.persona.apellido}, ${insc.estudiante.persona.nombre}`, x: 80, w: 170, align: 'left' as const },
        { texto: nombreCurso,   x: 253, w: 100, align: 'left'   as const },
        { texto: promGeneral.toFixed(2), x: 356, w: 70, align: 'center' as const },
        { texto: `${porcGeneral.toFixed(1)}%`, x: 429, w: 60, align: 'center' as const },
        { texto: aprobado ? 'PROMOVIDO' : 'REPROBADO', x: 492, w: 70, align: 'center' as const },
      ]

      datos.forEach(d => {
        const esResultado = d.texto === 'PROMOVIDO' || d.texto === 'REPROBADO'
        doc.fillColor(d.texto === 'REPROBADO' ? COLORES.rojo : d.texto === 'PROMOVIDO' ? COLORES.verde : COLORES.grisOscuro)
           .fontSize(8)
           .font(esResultado ? 'Helvetica-Bold' : 'Helvetica')
           .text(d.texto, d.x, yFila + 4, { width: d.w, align: d.align, lineBreak: false })
      })

      yFila += 18

      if (yFila > doc.page.height - 80) {
        dibujarPiePagina(doc, Math.ceil((i + 1) / 30))
        doc.addPage()
        dibujarEncabezado(doc)
        yFila = doc.y
      }
    })

    doc.rect(50, yFila, doc.page.width - 100, 22).fill(COLORES.azulOscuro)
    doc.fillColor(COLORES.blanco).fontSize(9).font('Helvetica-Bold')
       .text(`TOTAL: ${inscripciones.length} estudiantes`, 52, yFila + 6, { width: 250 })
       .text(`Aprobados: ${aprobados}`, 305, yFila + 6, { width: 120, align: 'center' })
       .text(`Tasa: ${inscripciones.length ? ((aprobados / inscripciones.length) * 100).toFixed(1) : 0}%`, 428, yFila + 6, { width: 134, align: 'center' })

    dibujarPiePagina(doc, 1)
    doc.end()
  } catch (error) {
    console.error('[reporte.getReporteAcademicoPDF]', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar el reporte PDF' })
    }
  }
}