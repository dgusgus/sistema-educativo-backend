// prisma/seeds/generar-excel.ts
//
// Genera los Excel de IMPORTACIÓN con el mismo formato de las plantillas del sistema
// (hoja "Plantilla" + hoja "Instrucciones"), con los datos del colegio de 900 estudiantes:
//
//   1_docentes.xlsx              37 docentes
//   2_estudiantes.xlsx           900 estudiantes, cada uno con su Curso (se inscriben al importar)
//   3_tutores.xlsx               900 filas: 772 tutores; los hermanos repiten el CI del tutor con otro EstudianteCI
//   4_estudiantes_con_errores.xlsx  14 filas: 9 con errores a propósito y 5 correctas (para ver el reporte por fila)
//
// Uso:  pnpm tsx prisma/seeds/generar-excel.ts [carpeta]      (por defecto prisma/seeds/excel)
// Antes: pnpm db:seed:perfil importacion --limpiar   (colegio con 24 cursos A-D y SIN docentes ni estudiantes)
// Importar EN ORDEN: docentes → estudiantes → tutores (los tutores se vinculan por el CI del estudiante).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generarExcel } from '../../src/lib/excel.helper.js'

const NOMBRES = ['Diego', 'Camila', 'Santiago', 'Fernanda', 'Mateo', 'Paola', 'Andrés', 'Daniela', 'Gabriel', 'Natalia', 'Cristián', 'Alejandra', 'Rodrigo', 'Carla', 'Felipe', 'María', 'José', 'Rosa', 'Luis', 'Elena']
const APELLIDOS = ['Condori', 'Mamani', 'Quispe', 'Flores', 'Tarqui', 'Huanca', 'Choque', 'Apaza', 'Ticona', 'Cruz', 'Ramos', 'Vargas', 'Torres', 'Choquehuanca', 'Paco', 'Limachi']
const CALLES = ['Av. Pagador', 'Calle Bolívar', 'Av. Cívica', 'Zona Los Ángeles', 'Urb. Bustillos', 'Calle Junín', 'Av. España', 'Zona Norte']
const OCUPACIONES = ['Comerciante', 'Chofer', 'Costurera', 'Albañil', 'Enfermera', 'Agricultor', 'Artesana', 'Mecánico']
const INSTRUCCION = ['Primaria', 'Secundaria', 'Técnico medio', 'Universitario']
const ESPECIALIDADES = ['Matemáticas', 'Lenguaje y Literatura', 'Ciencias Naturales', 'Ciencias Sociales', 'Inglés', 'Educación Física', 'Artes Plásticas', 'Técnica Tecnológica']
const HORAS = [5, 5, 4, 4, 3, 3, 2, 3]   // horas semanales por materia (mismo reparto que el perfil "carga": h+1 docentes por materia)
const nombreDe = (i: number) => NOMBRES[i % NOMBRES.length]
const apellidoDe = (i: number) => `${APELLIDOS[i % APELLIDOS.length]} ${APELLIDOS[(i * 5 + 3) % APELLIDOS.length]}`
const ANIO = new Date().getFullYear()
const dir = process.argv[2] ?? 'prisma/seeds/excel'
mkdirSync(dir, { recursive: true })

const ins = (columna: string, obligatoria: boolean, descripcion: string, ejemplo: string) => ({ columna, obligatoria, descripcion, ejemplo })
const guardar = (nombre: string, buf: Buffer) => { writeFileSync(join(dir, nombre), buf); console.log(`✓ ${nombre}`) }

// ── Docentes ───────────────────────────────────────────────────────────────
const docentes: Record<string, unknown>[] = []
HORAS.forEach((h, mi) => {
  for (let k = 0; k <= h; k++) {
    const n = docentes.length + 1
    docentes.push({
      CI: String(3000000 + n * 37), Nombre: nombreDe(n + 4), Apellido: apellidoDe(n + 40), Especialidad: ESPECIALIDADES[mi],
      Email: `docente${String(n).padStart(2, '0')}@ueangeles.edu.bo`, Telefono: String(70100000 + n * 13),
    })
  }
})

// ── Estudiantes (37 por curso + 1 extra a los primeros 12 cursos) ───────────
const cursos: { grado: number; par: string }[] = []
for (const g of [1, 2, 3, 4, 5, 6]) for (const p of ['A', 'B', 'C', 'D']) cursos.push({ grado: g, par: p })
const estudiantes: Record<string, unknown>[] = []
cursos.forEach((c, ci) => {
  const tam = 37 + (ci < 12 ? 1 : 0)
  for (let k = 0; k < tam; k++) {
    const n = estudiantes.length + 1
    estudiantes.push({
      CI: String(8000000 + n), Nombre: nombreDe(n), Apellido: apellidoDe(n),
      FechaNacimiento: new Date(Date.UTC(ANIO - 11 - c.grado - (n % 2), (n % 12), 1 + (n % 27))),
      Direccion: `${CALLES[n % CALLES.length]} ${100 + n}, Oruro`, RUDE: `${ANIO}${String(n).padStart(6, '0')}`,
      Curso: `${c.grado}${c.par}S`,
    })
  }
})

// ── Tutores (cada 7.º estudiante es hermano del anterior y comparte tutor) ─────
const tutores: Record<string, unknown>[] = []
let tutorN = 0, ultimo: Record<string, unknown> | null = null
estudiantes.forEach((e, n) => {
  if (n % 7 === 6 && ultimo) { tutores.push({ ...ultimo, EstudianteCI: e.CI, Parentesco: 'MADRE' }); return }
  tutorN++
  ultimo = {
    CI: String(6000000 + tutorN * 11), Nombre: nombreDe(tutorN * 3 + 1), Apellido: apellidoDe(tutorN * 7 + 2),
    Ocupacion: OCUPACIONES[tutorN % OCUPACIONES.length], GradoInstruccion: INSTRUCCION[tutorN % INSTRUCCION.length],
    Email: `tutor${String(tutorN).padStart(3, '0')}@correo.com`, Telefono: String(79100000 + tutorN),
    EstudianteCI: e.CI, Parentesco: tutorN % 2 ? 'MADRE' : 'PADRE',
  }
  tutores.push(ultimo)
})

// ── Estudiantes con errores a propósito ─────────────────────────────────────
const ok = (n: number, curso: string) => ({ CI: String(9000000 + n), Nombre: nombreDe(n), Apellido: apellidoDe(n), FechaNacimiento: new Date(Date.UTC(2011, 4, 10)), Direccion: 'Av. Pagador 100, Oruro', RUDE: `${ANIO}9${String(n).padStart(5, '0')}`, Curso: curso })
const errores: Record<string, unknown>[] = [
  ok(1, '1AS'), ok(2, '2BS'), ok(3, '3CS'),
  { ...ok(4, '1AS'), CI: String(8000001) },                       // fila 5: CI ya existe (está en 2_estudiantes)
  { ...ok(5, '1AS'), Nombre: '' },                                // fila 6: falta Nombre
  { ...ok(6, '1AS'), Apellido: '' },                              // fila 7: falta Apellido
  { ...ok(7, '7AS') },                                            // fila 8: curso inexistente
  { ...ok(8, 'XX') },                                             // fila 9: código de curso inválido
  { ...ok(9, '1AS'), CI: '@@##' },                                // fila 10: CI con caracteres no permitidos
  { ...ok(10, '1AS'), CI: '12' },                                 // fila 11: CI demasiado corto
  { ...ok(3, '1AS') },                                            // fila 12: CI repetido dentro del archivo (igual a la fila 4)
  { ...ok(11, '1AS'), FechaNacimiento: '31/02/2010' },            // fila 13: fecha imposible
  ok(12, '4DS'), ok(13, ''),                                      // fila 14-15: correctas (la 15 sin curso: se crea sin inscripción)
]

;(async () => {
  guardar('1_docentes.xlsx', await generarExcel('Plantilla', ['CI', 'Nombre', 'Apellido', 'Especialidad', 'Email', 'Telefono'], docentes, {
    columnasTexto: ['CI', 'Telefono'],
    instrucciones: [
      ins('CI', true, 'Cédula de identidad (con complemento si lo tiene)', '3456789'), ins('Nombre', true, 'Nombres del docente', 'Carlos'),
      ins('Apellido', true, 'Apellidos del docente', 'Flores Huanca'), ins('Especialidad', false, 'Área o materias que enseña', 'Inglés y Ed. Física'),
      ins('Email', false, 'Correo electrónico', 'cflores@correo.com'), ins('Telefono', false, 'Un solo número (dígitos, + - ( ) y espacios)', '70123456'),
    ],
  }))
  const instEst = [
    ins('CI', true, 'Cédula de identidad (con complemento si lo tiene)', '4567890'), ins('Nombre', true, 'Nombres del estudiante', 'Sofía'),
    ins('Apellido', true, 'Apellidos del estudiante', 'Condori Mamani'), ins('FechaNacimiento', false, 'dd/mm/aaaa, con año de 4 dígitos', '15/03/2010'),
    ins('Direccion', false, 'Domicilio', 'Av. 6 de Agosto 123'), ins('RUDE', false, 'Código RUDE', '12345678'),
    ins('Curso', false, 'Código del curso en la gestión elegida: grado + paralelo + P (primaria) o S (secundaria). Vacío = se crea sin inscripción', '1AS'),
  ]
  const opEst = { columnasTexto: ['CI', 'RUDE', 'Curso'], columnasFecha: ['FechaNacimiento'], instrucciones: instEst }
  const colEst = ['CI', 'Nombre', 'Apellido', 'FechaNacimiento', 'Direccion', 'RUDE', 'Curso']
  guardar('2_estudiantes.xlsx', await generarExcel('Plantilla', colEst, estudiantes, opEst))
  guardar('3_tutores.xlsx', await generarExcel('Plantilla', ['CI', 'Nombre', 'Apellido', 'Ocupacion', 'GradoInstruccion', 'Email', 'Telefono', 'EstudianteCI', 'Parentesco'], tutores, {
    columnasTexto: ['CI', 'Telefono', 'EstudianteCI'],
    instrucciones: [
      ins('CI', true, 'Cédula de identidad del tutor', '5678901'), ins('Nombre', true, 'Nombres del tutor', 'Rosa'), ins('Apellido', true, 'Apellidos del tutor', 'Quispe Mamani'),
      ins('Ocupacion', false, 'Ocupación', 'Comerciante'), ins('GradoInstruccion', false, 'Grado de instrucción', 'Secundaria'), ins('Email', false, 'Correo electrónico', 'rquispe@correo.com'),
      ins('Telefono', false, 'Un solo número (dígitos, + - ( ) y espacios)', '71234567'),
      ins('EstudianteCI', false, 'CI de un estudiante YA registrado al que se vincula. Si el tutor tiene varios hijos, repite la fila con el mismo CI y otro EstudianteCI', '4567890'),
      ins('Parentesco', false, 'Obligatorio si hay EstudianteCI: PADRE, MADRE, ABUELO, ABUELA, TIO, TIA, HERMANO, HERMANA, TUTOR_LEGAL u OTRO', 'MADRE'),
    ],
  }))
  guardar('4_estudiantes_con_errores.xlsx', await generarExcel('Plantilla', colEst, errores, opEst))
  console.log(`\n${docentes.length} docentes · ${estudiantes.length} estudiantes · ${tutores.length} filas de tutores (${tutorN} tutores) · ${errores.length} filas con errores → ${dir}`)
})()