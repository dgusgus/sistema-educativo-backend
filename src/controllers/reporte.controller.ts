import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { contarMorosos } from '../services/cobranza.service.js'
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

    // Se cuenta el dinero realmente recibido: también el de pagos PARCIALES (antes se
    // ignoraba y el total recaudado quedaba por debajo de lo que había en caja).
    const totalRecaudado = await prisma.pago.aggregate({
      where: { estado: { in: ['PAGADO', 'PARCIAL'] }, inscripcion: { gestionId: gestion.id } },
      _sum: { montoPagado: true },
    })

    // "Pagos pendientes" = estudiantes con deuda VENCIDA (concepto obligatorio, pasada su fecha).
    // Antes se contaban filas de Pago: quien nunca pagó nada no tenía filas y no figuraba como deudor.
    const pagosPendientes = await contarMorosos(gestion.id)

    const trimestres = await prisma.trimestre.findMany({
      where: { gestionId: gestion.id },
      select: { id: true, numero: true, nombre: true, cerrado: true },
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
// ─── GET /api/reportes/comparativo ───────────────────────────────────────────
// Rendimiento comparado entre gestiones: por gestión (inscritos, aprobación,
// promedios, asistencia), por grado y por materia. Sirve para ver tendencias
// ("¿mejoró Matemática de 2024 a 2025?") y no solo la gestión activa.
// Query opcional: ?desde=2023&hasta=2026
export const getReporteComparativo = async (req: Request, res: Response): Promise<void> => {
  const desde = Number(req.query.desde) || 0
  const hasta = Number(req.query.hasta) || 9999
  const num = (x: unknown) => (x === null || x === undefined ? null : Math.round(Number(x) * 100) / 100)

  try {
    const [porGestion, promTrim, asistencia, porGrado, porMateria] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT g.id AS "gestionId", g.anio,
               COUNT(i.id)::int AS inscritos,
               COUNT(*) FILTER (WHERE i."estadoInscripcion" = 'RETIRADA')::int AS retirados,
               COUNT(*) FILTER (WHERE i.resultado = 'PROMOVIDO')::int AS promovidos,
               COUNT(*) FILTER (WHERE i.resultado = 'REPROBADO')::int AS reprobados,
               COUNT(*) FILTER (WHERE i.resultado = 'PENDIENTE' AND i."estadoInscripcion" <> 'RETIRADA')::int AS pendientes,
               (SELECT AVG(pf."promedioFinal") FROM "PromedioFinal" pf JOIN "Inscripcion" i2 ON i2.id = pf."inscripcionId" WHERE i2."gestionId" = g.id) AS "promedioGeneral"
        FROM "Gestion" g LEFT JOIN "Inscripcion" i ON i."gestionId" = g.id
        WHERE g.anio BETWEEN ${desde} AND ${hasta}
        GROUP BY g.id, g.anio HAVING COUNT(i.id) > 0 ORDER BY g.anio`,
      prisma.$queryRaw<any[]>`
        SELECT i."gestionId", t.numero, AVG(c."promedioTrimestral") AS promedio
        FROM "Calificacion" c JOIN "Inscripcion" i ON i.id = c."inscripcionId"
        JOIN "Trimestre" t ON t.id = c."trimestreId" JOIN "Gestion" g ON g.id = i."gestionId"
        WHERE c."promedioTrimestral" IS NOT NULL AND g.anio BETWEEN ${desde} AND ${hasta}
        GROUP BY i."gestionId", t.numero`,
      prisma.$queryRaw<any[]>`
        SELECT i."gestionId", SUM(r."totalPresente" + r."totalRetraso" + r."totalJustificado")::float AS ok, SUM(r."totalClases")::float AS clases
        FROM "ResumenAsistencia" r JOIN "Inscripcion" i ON i.id = r."inscripcionId" JOIN "Gestion" g ON g.id = i."gestionId"
        WHERE g.anio BETWEEN ${desde} AND ${hasta} GROUP BY i."gestionId"`,
      prisma.$queryRaw<any[]>`
        SELECT g.anio, cu.nivel::text AS nivel, cu.grado,
               COUNT(DISTINCT i.id)::int AS estudiantes,
               COUNT(DISTINCT i.id) FILTER (WHERE i.resultado = 'PROMOVIDO')::int AS promovidos,
               COUNT(DISTINCT i.id) FILTER (WHERE i.resultado = 'REPROBADO')::int AS reprobados,
               AVG(pf."promedioFinal") AS promedio
        FROM "Inscripcion" i JOIN "Gestion" g ON g.id = i."gestionId"
        JOIN "Curso" cu ON cu.id = i."cursoId" AND cu."gestionId" = i."gestionId"
        LEFT JOIN "PromedioFinal" pf ON pf."inscripcionId" = i.id
        WHERE g.anio BETWEEN ${desde} AND ${hasta}
        GROUP BY g.anio, cu.nivel, cu.grado ORDER BY g.anio, cu.nivel, cu.grado`,
      prisma.$queryRaw<any[]>`
        SELECT g.anio, m.nombre AS materia, AVG(pf."promedioFinal") AS promedio,
               COUNT(*) FILTER (WHERE pf.resultado = 'REPROBADO')::int AS reprobados, COUNT(*)::int AS total
        FROM "PromedioFinal" pf JOIN "Inscripcion" i ON i.id = pf."inscripcionId"
        JOIN "Gestion" g ON g.id = i."gestionId"
        JOIN "DocenteMateriaCurso" d ON d.id = pf."docenteMateriaCursoId" JOIN "Materia" m ON m.id = d."materiaId"
        WHERE g.anio BETWEEN ${desde} AND ${hasta}
        GROUP BY g.anio, m.nombre ORDER BY m.nombre, g.anio`,
    ])

    const gestiones = porGestion.map(g => {
      const trims: Record<number, number | null> = {}
      promTrim.filter(t => t.gestionId === g.gestionId).forEach(t => { trims[t.numero] = num(t.promedio) })
      const a = asistencia.find(x => x.gestionId === g.gestionId)
      const evaluados = g.promovidos + g.reprobados
      return {
        gestionId: g.gestionId, anio: g.anio,
        inscritos: g.inscritos, retirados: g.retirados,
        promovidos: g.promovidos, reprobados: g.reprobados, pendientes: g.pendientes,
        tasaAprobacion: evaluados ? Math.round((g.promovidos / evaluados) * 1000) / 10 : null,
        promedioGeneral: num(g.promedioGeneral),
        promedioPorTrimestre: trims,
        asistencia: a && a.clases ? Math.round((a.ok / a.clases) * 1000) / 10 : null,
      }
    })

    res.status(200).json({
      gestiones,
      porGrado: porGrado.map(r => ({ ...r, promedio: num(r.promedio) })),
      porMateria: porMateria.map(r => ({ ...r, promedio: num(r.promedio) })),
    })
  } catch (error) {
    console.error('[reporte.getReporteComparativo]', error)
    res.status(500).json({ error: 'Error al generar el comparativo' })
  }
}