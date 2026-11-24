// prisma/seeds/datos-bolivia.ts
//
// Datos de personas REALISTAS y deterministas para las semillas (sin Math.random).
//
// ¿Para qué? Antes los ~900 estudiantes repetían los mismos 20 nombres y 16 apellidos (solo
// cambiaba el CI, que además eran letras+número: "V00450"). Para demostrar el sistema en vivo
// (buscar, filtrar, boletines, historial) se necesitan personas que PAREZCAN personas:
//
//   • Nombre y apellido ÚNICOS para cada persona del colegio (hasta 14.000).
//   • Apellidos paterno y materno distintos, de uso común en Oruro / el altiplano.
//   • CI boliviano: 7 dígitos (entre 4.000.000 y 9.999.999), y ~7 % con complemento
//     (ej. "5873210-1B"), tal como aparece en la cédula cuando hay homónimos.
//   • Sexo coherente con el nombre, teléfono celular de 8 dígitos y dirección de Oruro.
//   • CI único en TODA la base: cada "espacio" (estudiantes, egresados, tutores, docentes…)
//     usa un tramo propio de índices, así los perfiles se pueden combinar sin chocar.
//
// Todo sale de una función pura de (espacio, i): mismo perfil → mismas personas.

const NOMBRES_M = [
  'Diego', 'Mateo', 'Santiago', 'Gabriel', 'Rodrigo', 'Felipe', 'José', 'Luis', 'Carlos', 'Juan', 'Pedro', 'Miguel', 'Álvaro', 'Marco',
  'Andrés', 'Cristian', 'Daniel', 'David', 'Eduardo', 'Fernando', 'Gonzalo', 'Héctor', 'Iván', 'Jorge', 'Kevin', 'Leonardo', 'Marcelo',
  'Nelson', 'Óscar', 'Pablo', 'Ramiro', 'Sergio', 'Tomás', 'Víctor', 'Walter', 'Alan', 'Bryan', 'César', 'Denis', 'Edgar', 'Edwin', 'Elías',
  'Erick', 'Fabián', 'Franz', 'Freddy', 'Germán', 'Gustavo', 'Henry', 'Hugo', 'Ismael', 'Joel', 'Josué', 'Julio', 'Lucas', 'Mauricio',
  'Nicolás', 'Omar', 'Patricio', 'Raúl', 'Ricardo', 'Roberto', 'Rolando', 'Saúl', 'Samuel', 'Simón', 'Wilson', 'Yamil', 'Adrián', 'Alex',
  'Armando', 'Boris', 'Camilo', 'Clemente', 'Dante', 'Emilio', 'Ernesto', 'Gerardo', 'Ignacio', 'Joaquín', 'Lorenzo', 'Orlando',
]
const NOMBRES_F = [
  'María', 'Camila', 'Fernanda', 'Paola', 'Daniela', 'Natalia', 'Alejandra', 'Carla', 'Rosa', 'Elena', 'Ana', 'Lucía', 'Valeria', 'Sofía',
  'Gabriela', 'Andrea', 'Carolina', 'Claudia', 'Cecilia', 'Dayana', 'Erika', 'Estefanía', 'Fabiola', 'Flavia', 'Gladys', 'Gloria', 'Isabel',
  'Jimena', 'Johana', 'Karen', 'Karina', 'Katherine', 'Laura', 'Leticia', 'Lidia', 'Liliana', 'Lourdes', 'Luz', 'Marcela', 'Margarita',
  'Mariela', 'Marisol', 'Mayra', 'Melissa', 'Mónica', 'Nadia', 'Noemí', 'Olivia', 'Patricia', 'Pamela', 'Rebeca', 'Ruth', 'Sandra', 'Silvia',
  'Sonia', 'Tamara', 'Verónica', 'Vanesa', 'Viviana', 'Wendy', 'Yesenia', 'Zulema', 'Adriana', 'Alicia', 'Beatriz', 'Brenda', 'Carmen',
  'Celia', 'Dora', 'Elizabeth', 'Esther', 'Eva', 'Ximena', 'Yolanda', 'Judith', 'Julia', 'Miriam', 'Nancy', 'Nilda', 'Pilar', 'Roxana',
]
const APELLIDOS = [...new Set([
  'Mamani', 'Quispe', 'Condori', 'Flores', 'Choque', 'Apaza', 'Ticona', 'Huanca', 'Tarqui', 'Limachi', 'Colque', 'Copa', 'Nina', 'Callisaya',
  'Villca', 'Vargas', 'Rojas', 'Gutiérrez', 'Mendoza', 'Torrez', 'Ramos', 'Cruz', 'Paco', 'Poma', 'Yujra', 'Layme', 'Laura', 'Lupa', 'Mollo',
  'Cori', 'Challapa', 'Cussi', 'Gonzales', 'Rodríguez', 'Fernández', 'García', 'Martínez', 'López', 'Pérez', 'Sánchez', 'Ramírez', 'Castillo',
  'Salazar', 'Zárate', 'Arce', 'Aliaga', 'Alanoca', 'Aruquipa', 'Ayaviri', 'Bautista', 'Blanco', 'Burgos', 'Cáceres', 'Calle', 'Camacho',
  'Cárdenas', 'Casas', 'Chambi', 'Chávez', 'Choquehuanca', 'Chura', 'Escobar', 'Espinoza', 'Fuentes', 'Gallardo', 'Guzmán', 'Herrera',
  'Huallpa', 'Ibáñez', 'Jiménez', 'Lizarazu', 'Maldonado', 'Medina', 'Miranda', 'Morales', 'Moya', 'Navia', 'Ochoa', 'Orellana', 'Ortiz',
  'Paredes', 'Peñaranda', 'Quiroga', 'Quenta', 'Ríos', 'Rivera', 'Rocha', 'Romero', 'Salinas', 'Sandoval', 'Soto', 'Suárez', 'Terrazas',
  'Tola', 'Torrico', 'Ugarte', 'Valdez', 'Vásquez', 'Velasco', 'Vega', 'Villarroel', 'Zeballos', 'Zegarra', 'Zubieta', 'Álvarez', 'Aguilar',
  'Alvarado', 'Cabrera', 'Delgado', 'Montaño', 'Patzi', 'Siñani', 'Tito', 'Mayta',
])]
const NOMBRES = [...new Set([...NOMBRES_M, ...NOMBRES_F])]
const ES_FEMENINO = new Set(NOMBRES_F)

const ZONAS = ['Zona Central', 'Zona Norte', 'Zona Sud', 'Zona Este', 'Villa Challacollo', 'Barrio Bolívar', 'Villa Pagador', 'Zona Los Ángeles',
  'Urb. Bustillos', 'Barrio Minero', 'Zona Cívica', 'Villa Dolores']
const CALLES = ['Av. 6 de Agosto', 'Calle Bolívar', 'Calle Junín', 'Av. España', 'Av. Cívica', 'Calle Adolfo Mier', 'Calle Soria Galvarro', 'Calle Potosí',
  'Av. Villarroel', 'Calle La Plata']
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXYZ'

// ─── Espacios de identidad (cada uno con su tramo de índices → CI único en toda la base) ────
export type Espacio = 'EST' | 'EGR' | 'EGR2' | 'RET' | 'PROMO' | 'TUT' | 'DOC'
const BASE: Record<Espacio, number> = { EST: 0, EGR: 2000, EGR2: 4000, RET: 6000, PROMO: 8000, TUT: 10000, DOC: 12500 }
const TRAMO = 1500   // cada espacio admite hasta 2000 (EST) / 1500+ personas sin invadir al siguiente

/** Prefijo histórico de las semillas ('V', 'E', 'F', 'X', 'PR') → espacio de identidad. */
export function espacioDePrefijo(prefijo: string): Espacio {
  const mapa: Record<string, Espacio> = { V: 'EST', E: 'EGR', F: 'EGR2', X: 'RET', PR: 'PROMO' }
  const e = mapa[prefijo]
  if (!e) throw new Error(`Prefijo de CI desconocido "${prefijo}" (usa V, E, F, X o PR)`)
  return e
}

const M = NOMBRES.length * APELLIDOS.length      // pares (nombre, apellido paterno) distintos
const P = 104729                                  // primo: id → s = id·P mod M es una biyección

export interface PersonaDemo {
  ci: string
  nombre: string
  apellido: string
  sexo: 'MASCULINO' | 'FEMENINO'
  telefono: string
  direccion: string
}

/** Persona número `i` (1, 2, 3…) de un espacio. Pura y determinista. */
export function personaDe(espacio: Espacio, i: number): PersonaDemo {
  const id = BASE[espacio] + i
  if (i < 1 || id >= M) throw new Error(`Índice fuera de rango (${espacio} #${i})`)
  const s = (id * P) % M
  const nombre = NOMBRES[s % NOMBRES.length]
  const paterno = APELLIDOS[Math.floor(s / NOMBRES.length)]
  let k = (id * 13 + 7) % APELLIDOS.length
  if (APELLIDOS[k] === paterno) k = (k + 1) % APELLIDOS.length
  const materno = APELLIDOS[k]
  return {
    ci: ciDe(id),
    nombre,
    apellido: `${paterno} ${materno}`,
    sexo: ES_FEMENINO.has(nombre) ? 'FEMENINO' : 'MASCULINO',
    telefono: `${id % 3 === 0 ? 6 : 7}${String(1000000 + ((id * 7919) % 9000000)).slice(-7)}`,
    direccion: id % 2 ? `${CALLES[id % CALLES.length]} N° ${100 + ((id * 37) % 900)}, ${ZONAS[id % ZONAS.length]}` : `${ZONAS[id % ZONAS.length]}, ${CALLES[id % CALLES.length]} N° ${10 + ((id * 11) % 190)}`,
  }
}

// Permutación pseudoaleatoria de [0, RANGO): red de Feistel de 24 bits + "cycle walking".
// Es una biyección, así que dos ids distintos NUNCA dan el mismo CI, pero los CI de ids
// consecutivos quedan dispersos (como los de compañeros de curso reales, no una secuencia).
const RANGO_CI = 6_000_000
function feistel24(x: number): number {
  let l = x >>> 12, r = x & 0xfff
  for (const k of [0x9e3, 0x7f4, 0xb5a, 0x3c1]) {
    const f = (Math.imul(r + k, 0x9e3779b1) >>> 20) & 0xfff
    ;[l, r] = [r, l ^ f]
  }
  return (l << 12) | r
}
function permutarCi(id: number): number {
  let x = id
  do { x = feistel24(x) } while (x >= RANGO_CI)
  return x
}

/** CI de 7 dígitos (4.000.000-9.999.999) único por id; ~7 % con complemento ("5873210-1B"). */
export function ciDe(id: number): string {
  const numero = 4_000_000 + permutarCi(id)
  const conComplemento = id % 14 === 3
  return conComplemento ? `${numero}-${1 + (id % 9)}${LETRAS[id % LETRAS.length]}` : String(numero)
}

// Personas fijas que no salen del generador (siempre las mismas, para las credenciales de demo).
export const DIRECTOR_DEMO = { ci: '4521873', nombre: 'Roberto', apellido: 'Vargas Mamani', sexo: 'MASCULINO' as const, telefono: '71234501', direccion: 'Av. 6 de Agosto N° 450, Zona Central' }
export const SECRETARIA_DEMO = { ci: '5873210-1B', nombre: 'Marta', apellido: 'Rojas Ticona', sexo: 'FEMENINO' as const, telefono: '72345602', direccion: 'Calle Junín N° 220, Zona Norte' }

/** Tope de personas distintas que garantiza el generador. */
export const CAPACIDAD_NOMBRES = M
export { TRAMO }