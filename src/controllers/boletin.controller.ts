import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearDocumento, dibujarEncabezado, dibujarPiePagina, COLORES } from '../lib/pdf.js'
import { NIVEL_TEXTO } from '../lib/curso.helper.js'


import { asyncHandler } from '../lib/asyncHandler.js'
import { generarBoletinGeneral } from '../services/boletin.service.js'
import { obtenerMejoresEstudiantes as calcularMejoresEstudiantes } from '../services/boletin.service.js'
import { esDocenteDelCurso, esFamiliaDeEstudiante } from '../lib/ownership.helper.js'
import { obtenerDetalleBoletinEstudiante } from '../services/boletin.service.js'
 



// NOTA: el boletín muestra Calificacion.promedioTrimestral (el promedio
// ya ponderado por dimensiones — ver calificacion.helper.ts). No
// desglosa Ser/Saber/Hacer/Decidir por materia en esta versión; si se
// necesita ese detalle en el PDF, se puede leer de
// calificacion.dimensiones (include: { dimensiones: { include:
// { dimension: true } } }) y agregar columnas.

// ─── GET /api/boletin/:estudianteId/:trimestreId ──────────────────────────────
export const generarBoletin = async (req: Request, res: Response): Promise<void> => {
  const estudianteId = Number(req.params.estudianteId)
  const trimestreId = Number(req.params.trimestreId)

  try {
    // ✅ RBAC de pertenencia — Director/Secretaria pasan sin filtro; una
    // cuenta que SOLO tiene ESTUDIANTE y/o TUTOR (nunca ambas cosas con
    // Director/Secretaria) debe demostrar que el estudianteId de la URL
    // es el suyo propio o el de un hijo/tutorado vinculado. Sin esto,
    // cualquier estudiante o tutor autenticado podía cambiar el número
    // en la URL y descargar el boletín de otro estudiante cualquiera.
    const soloFamilia = req.user!.roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r))

    if (soloFamilia && req.user!.roles.includes('ESTUDIANTE')) {
      const estudiante = await prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id } })
      if (!estudiante || estudiante.id !== estudianteId) {
        res.status(403).json({ error: 'Sin permisos para ver el boletín de este estudiante' })
        return
      }
    } else if (soloFamilia && req.user!.roles.includes('TUTOR')) {
      const tutor = await prisma.tutor.findFirst({ where: { usuarioId: req.user!.id } })
      const vinculo = await prisma.tutorEstudiante.findFirst({ where: { tutorId: tutor?.id, estudianteId } })
      if (!vinculo) {
        res.status(403).json({ error: 'Sin permisos para ver el boletín de este estudiante' })
        return
      }
    }

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

    const notaMinima = Number(trimestre.gestion.notaMinimaAprobacion)

    const inscripcion = await prisma.inscripcion.findFirst({
      where: { estudianteId, gestionId: trimestre.gestionId },
      include: {
        estudiante: { include: { persona: true } },
        curso:      true,
        gestion:    true,
        calificaciones: {
          where: { trimestreId },
          include: {
            docenteMateriaCurso: {
              include: {
                materia: true,
                docente: { select: { persona: { select: { nombre: true, apellido: true } } } },
              },
            },
          },
          orderBy: { docenteMateriaCurso: { materia: { nombre: 'asc' } } },
        },
        resumenAsistencias: {
          where: { trimestreId },
          include: { docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } } },
        },
      },
    })

    if (!inscripcion) {
      res.status(404).json({ error: 'El estudiante no está inscrito en esta gestión' })
      return
    }

    const tutorVinculo = await prisma.tutorEstudiante.findFirst({
      where: { estudianteId },
      include: { tutor: { select: { persona: { select: { nombre: true, apellido: true } } } }, },
    })

    const doc = crearDocumento()

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="boletin_${inscripcion.estudiante.persona.apellido}_T${trimestre.numero}.pdf"`
    )

    doc.pipe(res)

    dibujarEncabezado(doc)

    doc
      .fillColor(COLORES.azulOscuro)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(`BOLETÍN DE CALIFICACIONES — ${trimestre.nombre.toUpperCase()}`, { align: 'center' })
      .moveDown(0.3)

    doc
      .fillColor(COLORES.grisMedio)
      .fontSize(10)
      .font('Helvetica')
      .text(`Gestión Académica ${trimestre.gestion.anio}`, { align: 'center' })
      .moveDown(1)

    const yDatos = doc.y
    doc.rect(50, yDatos, doc.page.width - 100, 80).fill(COLORES.azulClaro)

    doc.fillColor(COLORES.azulOscuro).fontSize(9).font('Helvetica-Bold')
       .text('DATOS DEL ESTUDIANTE', 60, yDatos + 8)

    doc.fillColor(COLORES.grisOscuro).fontSize(9).font('Helvetica')

    const col1 = 60
    const col2 = 320
    const nombreCursoTexto = `${inscripcion.curso.grado}° ${NIVEL_TEXTO[inscripcion.curso.nivel]}`

    doc.text(`Nombre:`, col1, yDatos + 22, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${inscripcion.estudiante.persona.nombre} ${inscripcion.estudiante.persona.apellido}`)

    doc.font('Helvetica')
       .text(`Carnet de Identidad:`, col1, yDatos + 36, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${inscripcion.estudiante.persona.ci ?? '—'}`)

    doc.font('Helvetica')
       .text(`Curso:`, col2, yDatos + 22, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${nombreCursoTexto}`)

    doc.font('Helvetica')
       .text(`Tutor/Padre:`, col2, yDatos + 36, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${tutorVinculo ? `${tutorVinculo.tutor.persona.nombre} ${tutorVinculo.tutor.persona.apellido}` : 'No registrado'}`)

    doc.font('Helvetica')
       .text(`Paralelo:`, col1, yDatos + 50, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${inscripcion.curso.paralelo}`)

    doc.font('Helvetica')
       .text(`Parentesco:`, col2, yDatos + 50, { continued: true })
       .font('Helvetica-Bold')
       .text(` ${tutorVinculo?.parentesco ?? '—'}`)

    doc.y = yDatos + 90
    doc.moveDown(0.5)

    doc.fillColor(COLORES.azulOscuro).fontSize(10).font('Helvetica-Bold')
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

    const encabezados = [
      { texto: 'MATERIA',  ...COL.materia,    alineacion: 'left'   as const },
      { texto: 'DOCENTE',  ...COL.docente,    alineacion: 'left'   as const },
      { texto: 'NOTA',     ...COL.nota,       alineacion: 'center' as const },
      { texto: '% ASIST.', ...COL.asistencia, alineacion: 'center' as const },
      { texto: 'ESTADO',   ...COL.estado,     alineacion: 'center' as const },
    ]

    doc.rect(50, yTabla, doc.page.width - 100, 22).fill(COLORES.azulOscuro)
    encabezados.forEach(col => {
      doc.fillColor(COLORES.blanco).fontSize(9).font('Helvetica-Bold')
         .text(col.texto, col.x, yTabla + 6, { width: col.ancho, align: col.alineacion, lineBreak: false })
    })

    let yActual = yTabla + 22
    inscripcion.calificaciones.forEach((cal, index) => {
      const fondo = index % 2 === 0 ? COLORES.grisClaro : COLORES.blanco

      const resumen = inscripcion.resumenAsistencias.find(r => r.docenteMateriaCursoId === cal.docenteMateriaCursoId)
      const porcentaje = resumen ? `${Number(resumen.porcentaje).toFixed(1)}%` : '—'
      const nota = Number(cal.promedioTrimestral ?? 0)
      const aprobado = nota >= notaMinima

      doc.rect(50, yActual, doc.page.width - 100, 20).fill(fondo)

      const columnas = [
        { texto: cal.docenteMateriaCurso.materia.nombre, ...COL.materia, alineacion: 'left' as const },
        { texto: `${cal.docenteMateriaCurso.docente.persona.nombre} ${cal.docenteMateriaCurso.docente.persona.apellido}`, ...COL.docente, alineacion: 'left' as const },
        { texto: cal.promedioTrimestral !== null ? nota.toFixed(1) : 'S/N', ...COL.nota, alineacion: 'center' as const },
        { texto: porcentaje, ...COL.asistencia, alineacion: 'center' as const },
        { texto: cal.promedioTrimestral === null ? 'PENDIENTE' : (aprobado ? 'APROBADO' : 'REPROBADO'), ...COL.estado, alineacion: 'center' as const },
      ]

      columnas.forEach(col => {
        const colorTexto = col.texto === 'REPROBADO' ? COLORES.rojo
          : col.texto === 'APROBADO' ? COLORES.verde
          : COLORES.grisOscuro

        doc.fillColor(colorTexto).fontSize(9)
           .font(col.texto === 'REPROBADO' || col.texto === 'APROBADO' ? 'Helvetica-Bold' : 'Helvetica')
           .text(col.texto, col.x, yActual + 5, { width: col.ancho, align: col.alineacion, lineBreak: false })
      })

      yActual += 20
    })

    const notasRegistradas = inscripcion.calificaciones.filter(c => c.promedioTrimestral !== null)
    const promGeneral = notasRegistradas.length
      ? notasRegistradas.reduce((sum, c) => sum + Number(c.promedioTrimestral), 0) / notasRegistradas.length
      : 0

    doc.rect(50, yActual, doc.page.width - 100, 24).fill(COLORES.azulOscuro)
    doc.fillColor(COLORES.blanco).fontSize(10).font('Helvetica-Bold')
       .text('PROMEDIO GENERAL DEL TRIMESTRE', 52, yActual + 6, { width: 340 })
       .text(promGeneral.toFixed(2), COL.nota.x, yActual + 6, { width: COL.nota.ancho, align: 'center' })
       .text(promGeneral >= notaMinima ? 'APROBADO' : 'REPROBADO', COL.estado.x, yActual + 6, { width: COL.estado.ancho, align: 'center' })

    yActual += 34
    doc.y = yActual
    doc.moveDown(1)

    doc.rect(50, doc.y, doc.page.width - 100, 50).stroke(COLORES.azulMedio)

    doc.fillColor(COLORES.azulOscuro).fontSize(9).font('Helvetica-Bold')
       .text('OBSERVACIONES:', 60, doc.y + 8)

    doc.fillColor(COLORES.grisOscuro).font('Helvetica')
       .text(inscripcion.observaciones ?? '', 60, doc.y + 20, { width: doc.page.width - 120 })

    doc.y += 60
    doc.moveDown(2)

    const yFirmas = doc.y
    const firmas = [
      { label: 'Director/a', x: 60 },
      { label: 'Secretario/a', x: 240 },
      { label: 'Tutor/Padre de Familia', x: 420 },
    ]

    firmas.forEach(firma => {
      doc.moveTo(firma.x, yFirmas + 30).lineTo(firma.x + 140, yFirmas + 30)
         .strokeColor(COLORES.grisOscuro).lineWidth(0.5).stroke()
      doc.fillColor(COLORES.grisMedio).fontSize(8).font('Helvetica')
         .text(firma.label, firma.x, yFirmas + 35, { width: 140, align: 'center' })
    })

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

    const notaMinima = Number(trimestre.gestion.notaMinimaAprobacion)

    const inscripciones = await prisma.inscripcion.findMany({
      where: { cursoId, gestionId: trimestre.gestionId },
      include: {
        estudiante: { include: { persona: true } },
        curso:      true,
        calificaciones: {
          where: { trimestreId },
          include: { docenteMateriaCurso: { include: { materia: true } } },
          orderBy: { docenteMateriaCurso: { materia: { nombre: 'asc' } } },
        },
        resumenAsistencias: {
          where: { trimestreId },
          include: { docenteMateriaCurso: { include: { materia: { select: { nombre: true } } } } },
        },
      },
      orderBy: { estudiante: { persona: { apellido: 'asc' } } },
    })

    if (inscripciones.length === 0) {
      res.status(404).json({ error: 'No hay estudiantes inscritos en este curso' })
      return
    }

    const curso = inscripciones[0].curso

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="boletines_${curso.nivel}_${curso.grado}_${curso.paralelo}_T${trimestre.numero}.pdf"`
    )

    const doc = crearDocumento()
    doc.pipe(res)

    inscripciones.forEach((insc, idx) => {
      if (idx > 0) doc.addPage()

      dibujarEncabezado(doc)

      doc.fillColor(COLORES.azulOscuro).fontSize(13).font('Helvetica-Bold')
         .text(`BOLETÍN — ${trimestre.nombre.toUpperCase()} — ${trimestre.gestion.anio}`, { align: 'center' })
         .moveDown(0.5)

      doc.rect(50, doc.y, doc.page.width - 100, 28).fill(COLORES.azulClaro)

      const nombreCursoTexto = `${insc.curso.grado}° ${NIVEL_TEXTO[insc.curso.nivel]} "${insc.curso.paralelo}"`
      doc.fillColor(COLORES.azulOscuro).fontSize(11).font('Helvetica-Bold')
         .text(
           `${insc.estudiante.persona.apellido}, ${insc.estudiante.persona.nombre} — ${nombreCursoTexto}`,
           60, doc.y + 8, { width: doc.page.width - 120 }
         )

      doc.y += 36
      doc.moveDown(0.5)

      const yT = doc.y
      doc.rect(50, yT, doc.page.width - 100, 20).fill(COLORES.azulOscuro)

      const cols = [
        { label: 'MATERIA',  x: 52,  w: 300 },
        { label: 'PROMEDIO', x: 354, w: 100 },
        { label: '% ASIST.', x: 456, w: 106 },
      ]

      cols.forEach(col => {
        doc.fillColor(COLORES.blanco).fontSize(8).font('Helvetica-Bold')
           .text(col.label, col.x, yT + 6, { width: col.w, align: 'center', lineBreak: false })
      })

      let yFila = yT + 20
      insc.calificaciones.forEach((cal, i) => {
        const fondo = i % 2 === 0 ? COLORES.grisClaro : COLORES.blanco
        doc.rect(50, yFila, doc.page.width - 100, 18).fill(fondo)

        const resumen = insc.resumenAsistencias.find(r => r.docenteMateriaCursoId === cal.docenteMateriaCursoId)
        const nota = cal.promedioTrimestral !== null ? Number(cal.promedioTrimestral).toFixed(1) : 'S/N'

        const datos = [
          { texto: cal.docenteMateriaCurso.materia.nombre, x: 52,  w: 300, align: 'left'   as const },
          { texto: nota,                                   x: 354, w: 100, align: 'center' as const },
          { texto: resumen ? `${Number(resumen.porcentaje).toFixed(0)}%` : '—', x: 456, w: 106, align: 'center' as const },
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



// GET /api/boletin/general/:cursoId
// Boletín General del curso completo en JSON (todas las materias, todos
// los trimestres, todos los estudiantes activos) — para pintar la tabla
// en pantalla ANTES de generar el PDF masivo. Mismo criterio de acceso
// que el resto de endpoints de curso: admin o docente con asignación ahí.
export const obtenerBoletinGeneral = asyncHandler(async (req, res) => {
  const cursoId = Number(req.params.cursoId)
  if (!Number.isInteger(cursoId)) {
    res.status(400).json({ error: 'cursoId inválido' })
    return
  }
 
  const curso = await prisma.curso.findUnique({ where: { id: cursoId }, select: { gestionId: true } })
  if (!curso) {
    res.status(404).json({ error: 'El curso no existe' })
    return
  }
 
  if (!(await esDocenteDelCurso(req, cursoId, curso.gestionId))) {
    res.status(403).json({ error: 'Sin acceso a este curso' })
    return
  }
 
  const boletin = await generarBoletinGeneral(cursoId)
  res.json(boletin)
})



// GET /api/boletin/mejores/:cursoId?limite=3
// Ranking de mejores estudiantes del curso — uno por trimestre + uno
// anual. Mismo criterio de acceso que /boletin/general/:cursoId.
export const obtenerMejoresEstudiantes = asyncHandler(async (req, res) => {
  const cursoId = Number(req.params.cursoId)
  if (!Number.isInteger(cursoId)) {
    res.status(400).json({ error: 'cursoId inválido' })
    return
  }
  const limite = req.query.limite ? Number(req.query.limite) : 3
  if (!Number.isInteger(limite) || limite < 1) {
    res.status(400).json({ error: 'limite debe ser un entero positivo' })
    return
  }
 
  const curso = await prisma.curso.findUnique({ where: { id: cursoId }, select: { gestionId: true } })
  if (!curso) {
    res.status(404).json({ error: 'El curso no existe' })
    return
  }
  if (!(await esDocenteDelCurso(req, cursoId, curso.gestionId))) {
    res.status(403).json({ error: 'Sin acceso a este curso' })
    return
  }
 
  const ranking = await calcularMejoresEstudiantes(cursoId, limite)
  res.json(ranking)
})
 
// GET /api/boletin/libreta/:estudianteId/:gestionId
// Libreta ANUAL: todas las materias x todos los trimestres + promedio
// general del año, en un único PDF — el "registro permanente", a
// diferencia de generarBoletin() (arriba) que es solo un trimestre.
// Reutiliza generarBoletinGeneral() y extrae la fila del estudiante
// pedido, así que sale con los mismos números que ve Secretaría en
// pantalla — nunca puede desincronizarse con esa tabla.
export const generarLibreta = async (req: Request, res: Response): Promise<void> => {
  const estudianteId = Number(req.params.estudianteId)
  const gestionId = Number(req.params.gestionId)
 
  try {
    // Mismo chequeo de pertenencia que generarBoletin() de arriba.
    const soloFamilia = req.user!.roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r))
    if (soloFamilia && req.user!.roles.includes('ESTUDIANTE')) {
      const estudiante = await prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id } })
      if (!estudiante || estudiante.id !== estudianteId) {
        res.status(403).json({ error: 'Sin permisos para ver la libreta de este estudiante' })
        return
      }
    } else if (soloFamilia && req.user!.roles.includes('TUTOR')) {
      const tutor = await prisma.tutor.findFirst({ where: { usuarioId: req.user!.id } })
      const vinculo = await prisma.tutorEstudiante.findFirst({ where: { tutorId: tutor?.id, estudianteId } })
      if (!vinculo) {
        res.status(403).json({ error: 'Sin permisos para ver la libreta de este estudiante' })
        return
      }
    }
 
    const inscripcion = await prisma.inscripcion.findFirst({
      where: { estudianteId, gestionId },
      include: { estudiante: { include: { persona: true } }, curso: true, gestion: true },
    })
    if (!inscripcion) {
      res.status(404).json({ error: 'El estudiante no está inscrito en esta gestión' })
      return
    }
 
    const boletin = await generarBoletinGeneral(inscripcion.cursoId)
    const fila = boletin.estudiantes.find(e => e.inscripcionId === inscripcion.id)
    if (!fila) {
      res.status(404).json({ error: 'No se encontraron notas para este estudiante en esta gestión' })
      return
    }
 
    const tutorVinculo = await prisma.tutorEstudiante.findFirst({
      where: { estudianteId },
      include: { tutor: { select: { persona: { select: { nombre: true, apellido: true } } } } },
    })
    const notaMinima = Number(inscripcion.gestion.notaMinimaAprobacion)
 
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="libreta_${inscripcion.estudiante.persona.apellido}_${boletin.curso.anioGestion}.pdf"`
    )
 
    const doc = crearDocumento()
    doc.pipe(res)
    dibujarEncabezado(doc)
 
    doc.fillColor(COLORES.azulOscuro).fontSize(13).font('Helvetica-Bold')
       .text(`LIBRETA DE CALIFICACIONES — GESTIÓN ${boletin.curso.anioGestion}`, { align: 'center' })
       .moveDown(0.5)
 
    const yDatos = doc.y
    doc.rect(50, yDatos, doc.page.width - 100, 66).fill(COLORES.azulClaro)
    doc.fillColor(COLORES.azulOscuro).fontSize(9).font('Helvetica-Bold').text('DATOS DEL ESTUDIANTE', 60, yDatos + 8)
    doc.fillColor(COLORES.grisOscuro).fontSize(9).font('Helvetica')
 
    const nombreCursoTexto = `${NIVEL_TEXTO[boletin.curso.nivel as keyof typeof NIVEL_TEXTO]} ${boletin.curso.grado}° "${boletin.curso.paralelo}"`
    doc.text('Nombre:', 60, yDatos + 22, { continued: true }).font('Helvetica-Bold')
       .text(` ${inscripcion.estudiante.persona.nombre} ${inscripcion.estudiante.persona.apellido}`)
    doc.font('Helvetica').text('RUDE:', 60, yDatos + 36, { continued: true }).font('Helvetica-Bold')
       .text(` ${inscripcion.estudiante.rude ?? '—'}`)
    doc.font('Helvetica').text('Curso:', 320, yDatos + 22, { continued: true }).font('Helvetica-Bold')
       .text(` ${nombreCursoTexto}`)
    doc.font('Helvetica').text('Tutor/Padre:', 320, yDatos + 36, { continued: true }).font('Helvetica-Bold')
       .text(` ${tutorVinculo ? `${tutorVinculo.tutor.persona.nombre} ${tutorVinculo.tutor.persona.apellido}` : 'No registrado'}`)
 
    doc.y = yDatos + 76
    doc.moveDown(0.3)
 
    // Tabla: Materia | T1 | T2 | T3 (dinámico) | Anual | Resultado —
    // agrupada por Campo de Saber, igual que la tabla en pantalla.
    const yT = doc.y
    const anchoTrim = 45
    const COL = {
      materia:   { x: 52, ancho: 190 },
      t:         boletin.trimestres.map((_, i) => ({ x: 244 + i * anchoTrim, ancho: anchoTrim })),
      anual:     { x: 244 + boletin.trimestres.length * anchoTrim,      ancho: 55 },
      resultado: { x: 244 + boletin.trimestres.length * anchoTrim + 55, ancho: 90 },
    }
 
    doc.rect(50, yT, doc.page.width - 100, 20).fill(COLORES.azulOscuro)
    doc.fillColor(COLORES.blanco).fontSize(8).font('Helvetica-Bold')
       .text('MATERIA', COL.materia.x, yT + 6, { width: COL.materia.ancho, lineBreak: false })
    boletin.trimestres.forEach((t, i) => {
      doc.text(`T${t.numero}`, COL.t[i].x, yT + 6, { width: COL.t[i].ancho, align: 'center', lineBreak: false })
    })
    doc.text('ANUAL',     COL.anual.x,     yT + 6, { width: COL.anual.ancho,     align: 'center', lineBreak: false })
    doc.text('RESULTADO', COL.resultado.x, yT + 6, { width: COL.resultado.ancho, align: 'center', lineBreak: false })
 
    let yFila = yT + 20
    let campoActual = ''
    fila.materias.forEach((m, idx) => {
      const materiaMeta = boletin.materias[idx]
 
      if (materiaMeta.campoSaber && materiaMeta.campoSaber !== campoActual) {
        campoActual = materiaMeta.campoSaber
        doc.rect(50, yFila, doc.page.width - 100, 14).fill(COLORES.azulMedio)
        doc.fillColor(COLORES.blanco).fontSize(7).font('Helvetica-Bold')
           .text(campoActual.toUpperCase(), 54, yFila + 3, { lineBreak: false })
        yFila += 14
      }
 
      const fondo = idx % 2 === 0 ? COLORES.grisClaro : COLORES.blanco
      doc.rect(50, yFila, doc.page.width - 100, 18).fill(fondo)
      doc.fillColor(COLORES.grisOscuro).fontSize(8).font('Helvetica')
         .text(materiaMeta.nombre, COL.materia.x, yFila + 4, { width: COL.materia.ancho, lineBreak: false })
 
      boletin.trimestres.forEach((t, i) => {
        const nota = m.notasPorTrimestre[t.id]
        doc.text(nota !== null ? nota.toFixed(0) : '—', COL.t[i].x, yFila + 4, { width: COL.t[i].ancho, align: 'center', lineBreak: false })
      })
 
      doc.font('Helvetica-Bold')
         .text(m.promedioAnual !== null ? m.promedioAnual.toFixed(0) : '—', COL.anual.x, yFila + 4, { width: COL.anual.ancho, align: 'center', lineBreak: false })
 
      const colorResultado = m.resultado === 'REPROBADO' ? COLORES.rojo : m.resultado === 'PROMOVIDO' ? COLORES.verde : COLORES.grisMedio
      doc.fillColor(colorResultado).font('Helvetica-Bold')
         .text(m.resultado, COL.resultado.x, yFila + 4, { width: COL.resultado.ancho, align: 'center', lineBreak: false })
 
      yFila += 18
    })
 
    doc.rect(50, yFila, doc.page.width - 100, 24).fill(COLORES.azulOscuro)
    doc.fillColor(COLORES.blanco).fontSize(10).font('Helvetica-Bold')
       .text('PROMEDIO GENERAL', 52, yFila + 6, { width: 340 })
       .text(fila.promedioGeneralAnual !== null ? fila.promedioGeneralAnual.toFixed(2) : '—', COL.anual.x, yFila + 6, { width: COL.anual.ancho, align: 'center' })
       .text(
         fila.promedioGeneralAnual !== null ? (fila.promedioGeneralAnual >= notaMinima ? 'PROMOVIDO' : 'REPROBADO') : 'PENDIENTE',
         COL.resultado.x, yFila + 6, { width: COL.resultado.ancho, align: 'center' }
       )
 
    doc.y = yFila + 34
    doc.moveDown(2)
 
    const yFirmas = doc.y
    const firmas = [
      { label: 'Director/a', x: 60 },
      { label: 'Secretario/a', x: 240 },
      { label: 'Tutor/Padre de Familia', x: 420 },
    ]
    firmas.forEach(f => {
      doc.moveTo(f.x, yFirmas + 30).lineTo(f.x + 140, yFirmas + 30).strokeColor(COLORES.grisOscuro).lineWidth(0.5).stroke()
      doc.fillColor(COLORES.grisMedio).fontSize(8).font('Helvetica').text(f.label, f.x, yFirmas + 35, { width: 140, align: 'center' })
    })
 
    dibujarPiePagina(doc, 1)
    doc.end()
  } catch (error) {
    console.error('[boletin.generarLibreta]', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar la libreta' })
    }
  }
}


// GET /api/boletin/detalle/:inscripcionId
export const obtenerDetalleEstudiante = asyncHandler(async (req, res) => {
  const inscripcionId = Number(req.params.inscripcionId)
  if (!Number.isInteger(inscripcionId)) {
    res.status(400).json({ error: 'inscripcionId inválido' })
    return
  }
 
  const inscripcion = await prisma.inscripcion.findUnique({
    where: { id: inscripcionId },
    select: { estudianteId: true, cursoId: true, gestionId: true },
  })
  if (!inscripcion) {
    res.status(404).json({ error: 'La inscripción no existe' })
    return
  }
 
  const tieneAcceso =
    (await esDocenteDelCurso(req, inscripcion.cursoId, inscripcion.gestionId)) ||
    (await esFamiliaDeEstudiante(req, inscripcion.estudianteId))
 
  if (!tieneAcceso) {
    res.status(403).json({ error: 'Sin acceso a este estudiante' })
    return
  }
 
  const detalle = await obtenerDetalleBoletinEstudiante(inscripcionId)
  res.json(detalle)
})