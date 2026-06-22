import PDFDocument from 'pdfkit'

// ─── Colores institucionales ──────────────────────────────────────────────────
export const COLORES = {
  azulOscuro:  '#1A3C5E',
  azulMedio:   '#2E6DA4',
  azulClaro:   '#EBF2FA',
  grisOscuro:  '#333333',
  grisMedio:   '#666666',
  grisClaro:   '#F5F5F5',
  verde:       '#2E7D32',
  rojo:        '#C0392B',
  blanco:      '#FFFFFF',
}

// ─── Crear documento PDF base ─────────────────────────────────────────────────
export const crearDocumento = () => {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: {
      Title:    'U.E. Los Ángeles de Nazaria Ignacia',
      Author:   'Sistema Web Académico',
      Creator:  'Sistema Web U.E. Los Ángeles',
    },
  })
}

// ─── Encabezado institucional ─────────────────────────────────────────────────
export const dibujarEncabezado = (doc: PDFKit.PDFDocument) => {
  // Fondo del encabezado
  doc
    .rect(50, 50, doc.page.width - 100, 80)
    .fill(COLORES.azulOscuro)

  // Nombre de la institución
  doc
    .fillColor(COLORES.blanco)
    .fontSize(14)
    .font('Helvetica-Bold')
    .text('UNIDAD EDUCATIVA', 60, 62, { align: 'center', width: doc.page.width - 120 })

  doc
    .fontSize(16)
    .text('"LOS ÁNGELES DE NAZARIA IGNACIA"', 60, 80, {
      align: 'center',
      width: doc.page.width - 120,
    })

  doc
    .fontSize(9)
    .font('Helvetica')
    .text('Urb. Bustillos, Zona Los Ángeles — Oruro, Bolivia | RUE: 81230370', 60, 103, {
      align: 'center',
      width: doc.page.width - 120,
    })

  // Línea separadora
  doc
    .moveTo(50, 140)
    .lineTo(doc.page.width - 50, 140)
    .strokeColor(COLORES.azulMedio)
    .lineWidth(2)
    .stroke()

  doc.moveDown(0.5)
}

// ─── Pie de página ────────────────────────────────────────────────────────────
export const dibujarPiePagina = (doc: PDFKit.PDFDocument, pagina: number) => {
  const y = doc.page.height - 50

  doc
    .moveTo(50, y - 10)
    .lineTo(doc.page.width - 50, y - 10)
    .strokeColor(COLORES.azulMedio)
    .lineWidth(0.5)
    .stroke()

  doc
    .fillColor(COLORES.grisMedio)
    .fontSize(8)
    .font('Helvetica')
    .text(
      `Sistema Web Académico U.E. Los Ángeles de Nazaria Ignacia`,
      50, y,
      { align: 'left', width: 300 }
    )
    .text(
      `Página ${pagina} | ${new Date().toLocaleDateString('es-BO')}`,
      0, y,
      { align: 'right' }
    )
}

// ─── Fila de tabla con fondo alternado ───────────────────────────────────────
export const dibujarFilaTabla = (
  doc: PDFKit.PDFDocument,
  columnas: { texto: string; x: number; ancho: number; alineacion?: 'left' | 'center' | 'right' }[],
  y: number,
  fondo: string,
  colorTexto = COLORES.grisOscuro,
  alturaFila = 20
) => {
  // Fondo de la fila
  doc
    .rect(50, y, doc.page.width - 100, alturaFila)
    .fill(fondo)

  // Texto de cada columna
  columnas.forEach(col => {
    doc
      .fillColor(colorTexto)
      .fontSize(9)
      .font('Helvetica')
      .text(col.texto, col.x, y + 5, {
        width:  col.ancho,
        align:  col.alineacion ?? 'left',
        lineBreak: false,
      })
  })
}

// ─── Encabezado de tabla ──────────────────────────────────────────────────────
export const dibujarEncabezadoTabla = (
  doc: PDFKit.PDFDocument,
  columnas: { texto: string; x: number; ancho: number; alineacion?: 'left' | 'center' | 'right' }[],
  y: number
) => {
  dibujarFilaTabla(doc, columnas, y, COLORES.azulOscuro, COLORES.blanco, 22)
  columnas.forEach(col => {
    doc.font('Helvetica-Bold')
  })
}