import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { construirCuaderno, construirCuadernoGestion } from '../src/lib/excel/cuaderno.builder.js'
import { nombreHoja } from '../src/lib/excel/estilos.js'
import { datosEjemplo } from './cuaderno.fixture.js'

async function leer(buffer: Buffer) {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(buffer as unknown as ArrayBuffer)
  return libro
}

describe('construirCuaderno', () => {
  it('genera carátula, filiación y una hoja de valoración por área', async () => {
    const libro = await leer(await construirCuaderno(datosEjemplo()))
    const nombres = libro.worksheets.map(h => h.name)
    expect(nombres.slice(0, 5)).toEqual(['CARATULA', 'FILIA', 'HORARIO', 'REGISTRO PPFF', 'ENTREVISTA PPFF'])
    expect(nombres).toHaveLength(5 + 9 * 2 + 3)    // por cada área: centralizador + valoración; más boletín, mejores y libretas
    expect(nombres).toContain('CENTRA MAT')
    expect(nombres).toContain('MAT 1 TRIM')
  })

  it('no escribe fórmulas: solo valores', async () => {
    const libro = await leer(await construirCuaderno(datosEjemplo()))
    for (const hoja of libro.worksheets) {
      hoja.eachRow(fila => fila.eachCell(celda => {
        expect(typeof celda.value === 'object' && celda.value !== null && 'formula' in celda.value).toBe(false)
      }))
    }
  })

  it('la filiación crece con la cantidad de estudiantes (sin tope de 15)', async () => {
    const libro = await leer(await construirCuaderno(datosEjemplo()))
    const h = libro.getWorksheet('FILIA')!
    expect(h.getCell('C8').value).toBe('CASTRO SANJINEZ')
    expect(h.getCell('C25').value).toBe('PAREDES LUNA')      // estudiante 18 → fila 8 + 17
    expect(String(h.getCell('B8').value)).toMatch(/^81230370/)   // RUDE como texto
  })

  it('la hoja de valoración muestra la nota total y las estadísticas del pie', async () => {
    const datos = datosEjemplo()
    const area = datos.areas.find(a => a.codigo === 'MAT')!
    const libro = await leer(await construirCuaderno(datos))
    const h = libro.getWorksheet('MAT 1 TRIM')!

    // Columnas: A,B | Ser 3 act.+prom (3-6) | Saber 5+1 (7-12) | Hacer 4+1 (13-17) | desarrollo 18 | autoevaluación 19 | total 20
    expect(h.getCell(12, 3).value).toContain('Ser 1')
    expect(h.getCell(10, 3).value).toBe('SER')
    expect(h.getCell(11, 3).value).toBe('VALORACIÓN 10 Pts')
    expect(h.getCell(10, 19).value).toBe('AUTOEVALUACIÓN - 5 Pts')
    expect(h.getCell(10, 20).value).toBe('PROM. 1er TRIM.')

    const primera = area.filas[0]
    expect(h.getCell(13, 2).value).toBe('CASTRO SANJINEZ LUCAS')
    expect(h.getCell(13, 20).value).toBe(primera.total)

    // pie: total de estudiantes y aprobados coinciden con el resumen calculado
    // (una celda fusionada repite su valor en cada columna: se cuenta una vez por fila)
    const filasPie = new Map<string, number>()
    h.eachRow((fila, nFila) => fila.eachCell(c => {
      if (c.value === 'TOTAL DE ESTUDIANTES' || c.value === 'TOTAL APROBADOS') filasPie.set(String(c.value), nFila)
    }))
    expect(filasPie.size).toBe(2)
    expect(h.getCell(filasPie.get('TOTAL DE ESTUDIANTES')!, 20).value).toBe(area.resumen.totalEstudiantes)
    expect(h.getCell(filasPie.get('TOTAL APROBADOS')!, 20).value).toBe(area.resumen.aprobados)
  })

  it('un curso sin estudiantes ni áreas igual genera un libro válido', async () => {
    const vacio = { ...datosEjemplo(), estudiantes: [], areas: [] }
    const libro = await leer(await construirCuaderno(vacio))
    expect(libro.worksheets.map(h => h.name)).toEqual(['CARATULA', 'FILIA', 'HORARIO', 'REGISTRO PPFF', 'ENTREVISTA PPFF'])
  })
})

describe('construirCuadernoGestion', () => {
  it('une los 3 trimestres: una hoja de valoración por área y trimestre', async () => {
    const t = (n: number) => ({ ...datosEjemplo(), trimestre: { id: n, numero: n, nombre: `Trimestre ${n}` } })
    const libro = await leer(await construirCuadernoGestion([t(1), t(2), t(3)]))
    const nombres = libro.worksheets.map(h => h.name)
    for (const n of [1, 2, 3]) expect(nombres).toContain(`MAT ${n} TRIM`)
    expect(nombres).toContain('ENTREVISTA PPFF 3T')
  })
})

describe('nombreHoja', () => {
  it('limpia caracteres prohibidos, limita a 31 y evita duplicados', () => {
    const usados = new Set<string>()
    expect(nombreHoja('A/B:C*D', usados)).toBe('A-B-C-D')
    expect(nombreHoja('A/B:C*D', usados)).toBe('A-B-C-D (2)')
    expect(nombreHoja('x'.repeat(40), usados)).toHaveLength(31)
  })
})
