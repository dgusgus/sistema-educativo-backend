// Datos de ejemplo para probar el generador del cuaderno SIN base de datos:
// 3° de primaria "A", 9 áreas, 18 estudiantes y las 4 dimensiones de la gestión 2026
// (Ser 10, Saber 45, Hacer 40, Autoevaluación 5).
import type { AreaCuaderno, DatosCuaderno, EstudianteCuaderno } from '../src/services/cuaderno.service.js'
import { armarHorario } from '../src/lib/cuaderno.horario.js'
import { autoevaluacion, desarrolloCurricular, redondear, resumirNotas } from '../src/lib/cuaderno.calculo.js'

const APELLIDOS = ['CASTRO SANJINEZ', 'FERRUFINO MAMANI', 'QUISPE CONDORI', 'MAMANI FLORES', 'CHOQUE APAZA', 'COPA ARIAS',
  'VARGAS ROJAS', 'CRUZ LIMACHI', 'ROJAS COLQUE', 'GUZMAN TORREZ', 'ARCE PEREZ', 'LOPEZ VILLCA',
  'FLORES GUTIERREZ', 'CONDORI MAMANI', 'SALAZAR QUISPE', 'MENDOZA CRUZ', 'TICONA ALARCON', 'PAREDES LUNA']
const NOMBRES = ['LUCAS', 'OMAR', 'ANA', 'DIEGO', 'MARIA', 'JOSE', 'LUZ', 'CARLOS', 'ROSA', 'PABLO', 'SOFIA', 'MARCO',
  'ELENA', 'JUAN', 'VALERIA', 'DAVID', 'CAMILA', 'RENE']

// Generador pseudoaleatorio fijo: el mismo libro en cada ejecución
function semilla(n: number) { let s = n; return () => (s = (s * 16807) % 2147483647) / 2147483647 }

export function datosEjemplo(): DatosCuaderno {
  const azar = semilla(7)
  const estudiantes: EstudianteCuaderno[] = APELLIDOS.map((ap, i) => ({
    inscripcionId: 100 + i, numero: i + 1,
    rude: `8123037020260${String(i + 1).padStart(3, '0')}`,
    apellidos: ap, nombres: NOMBRES[i], nombreCompleto: `${ap} ${NOMBRES[i]}`,
    direccion: i % 3 === 0 ? '' : `Calle ${i + 1} #${100 + i}, Zona Central`,
    telefono: i % 4 === 0 ? '' : `7${String(1000000 + i * 12345).slice(0, 7)}`,
    madre: i % 5 === 0 ? null : { nombre: `Madre de ${NOMBRES[i]}`, ocupacion: 'Comerciante', telefono: '' },
    padre: { nombre: `Padre de ${NOMBRES[i]}`, ocupacion: i % 2 ? 'Minero' : 'Chofer', telefono: '' },
  }))

  const defs = [
    ['LC', 'COMUNICACIÓN Y LENGUAJES', 'COMUNIDAD Y SOCIEDAD'], ['CS', 'CIENCIAS SOCIALES', 'COMUNIDAD Y SOCIEDAD'],
    ['EDF', 'EDUCACIÓN FÍSICA Y DEPORTES', 'COMUNIDAD Y SOCIEDAD'], ['EM', 'EDUCACIÓN MUSICAL', 'COMUNIDAD Y SOCIEDAD'],
    ['AP', 'ARTES PLÁSTICAS Y VISUALES', 'COMUNIDAD Y SOCIEDAD'], ['MAT', 'MATEMÁTICAS', 'CIENCIA, TECNOLOGÍA Y PRODUCCIÓN'],
    ['TT', 'TÉCNICA TECNOLÓGICA', 'CIENCIA, TECNOLOGÍA Y PRODUCCIÓN'], ['CN', 'CIENCIAS NATURALES', 'VIDA, TIERRA Y TERRITORIO'],
    ['VER', 'VALORES, ESPIRITUALIDAD Y RELIGIONES', 'COSMOS Y PENSAMIENTO'],
  ]
  const dims = [
    { dimensionId: 1, nombre: 'Ser', puntajeMaximo: 10, esAutoevaluada: false, nAct: 3 },
    { dimensionId: 2, nombre: 'Saber', puntajeMaximo: 45, esAutoevaluada: false, nAct: 5 },
    { dimensionId: 3, nombre: 'Hacer', puntajeMaximo: 40, esAutoevaluada: false, nAct: 4 },
    { dimensionId: 4, nombre: 'Autoevaluación', puntajeMaximo: 5, esAutoevaluada: true, nAct: 0 },
  ]

  let idAct = 1
  const areas: AreaCuaderno[] = defs.map(([codigo, materia, campo], k) => {
    const dimensiones = dims.map(d => ({
      dimensionId: d.dimensionId, nombre: d.nombre, puntajeMaximo: d.puntajeMaximo, esAutoevaluada: d.esAutoevaluada,
      actividades: Array.from({ length: d.nAct }, (_, j) => ({
        id: idAct++, nombre: `${d.nombre} ${j + 1}: actividad de ${materia.split(' ')[0].toLowerCase()}`, puntajeMaximo: d.puntajeMaximo,
      })),
    }))
    const filas = estudiantes.map((e, idx) => {
      const sinNotas = k === 8 && idx >= 16          // un par de estudiantes sin notas todavía
      const notas: Record<number, number> = {}
      const promedioDimension: Record<number, number> = {}
      if (!sinNotas) {
        for (const d of dimensiones) {
          const nivel = 0.4 + azar() * 0.6 - (idx === 5 ? 0.35 : 0)   // el estudiante 6 va mal
          let suma = 0
          for (const a of d.actividades) { const n = redondear(a.puntajeMaximo * Math.min(1, nivel + (azar() - 0.5) * 0.2), 1); notas[a.id] = n; suma += n }
          promedioDimension[d.dimensionId] = d.actividades.length ? suma / d.actividades.length : redondear(d.puntajeMaximo * nivel, 1)
        }
      }
      const puntos = dimensiones.map(d => ({ esAutoevaluada: d.esAutoevaluada, promedio: promedioDimension[d.dimensionId] ?? null }))
      const des = desarrolloCurricular(puntos); const aut = autoevaluacion(puntos)
      return { inscripcionId: e.inscripcionId, notas, promedioDimension, desarrollo: des, autoevaluacion: aut,
        total: des === null ? null : redondear(des + (aut ?? 0)) }
    })
    return { docenteMateriaCursoId: 500 + k, materia, codigo, campoSaber: campo, docente: 'Flavio Cuiza Mamani',
      dimensiones, filas, resumen: resumirNotas(filas.map(f => f.total), 51),
      centralizador: { filas: filas.map(f => ({ inscripcionId: f.inscripcionId, porTrimestre: { 1: f.total, 2: null, 3: null }, promedioAnual: null, resultado: null })),
        resumen: { totalEstudiantes: 0, aprobados: 0, reprobados: 0, promedio: null, porcentajeAprobados: null, porcentajeReprobados: null } } }
  })

  return {
    institucion: { nombre: 'LITORAL DE CULTA', rue: '81110010', municipio: 'TOTORA', departamento: 'ORURO' },
    gestion: { anio: 2026, notaMinimaAprobacion: 51 },
    curso: { nivel: 'PRIMARIO', grado: 'TERCERO', paralelo: 'A', turno: 'MAÑANA' },
    docentePrincipal: 'Flavio Cuiza Mamani',
    trimestre: { id: 1, numero: 1, nombre: 'Primer trimestre' },
    trimestres: [{ id: 1, numero: 1, nombre: 'Primer trimestre' }, { id: 2, numero: 2, nombre: 'Segundo trimestre' }, { id: 3, numero: 3, nombre: 'Tercer trimestre' }],
    estudiantes, asistencia: [], areas, areasCompletas: true,
    horario: armarHorario([
      { dia: 'LUNES', inicio: '08:00', fin: '08:40', materia: 'MATEMÁTICAS', aula: null },
      { dia: 'LUNES', inicio: '08:40', fin: '09:20', materia: 'COMUNICACIÓN Y LENGUAJES', aula: null },
      { dia: 'LUNES', inicio: '09:40', fin: '10:20', materia: 'CIENCIAS NATURALES', aula: null },
      { dia: 'MARTES', inicio: '08:00', fin: '08:40', materia: 'EDUCACIÓN FÍSICA Y DEPORTES', aula: 'Cancha' },
    ]),
  }
}
