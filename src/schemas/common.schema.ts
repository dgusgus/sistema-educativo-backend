// src/schemas/common.schema.ts
//
// Piezas reutilizables para validar el cuerpo (req.body) de las peticiones.
//
// ¿Por qué zod? Antes cada controlador hacía `req.body as { ... }`: ese `as`
// es solo una promesa al compilador, en ejecución no comprueba nada. Un
// "monto": "abc", un id negativo o una fecha "31 de febrero" pasaban hasta la
// base de datos y volvían como error 500. Ahora la forma de los datos se
// comprueba ANTES de llegar al controlador, y los tipos salen del esquema.
//
// Criterios de diseño (para no romper al frontend que ya existe):
//  • Los campos que no están en el esquema se DESCARTAN (no se rechazan).
//  • Los números aceptan texto numérico ("5"): los formularios web a veces lo envían.
//  • En fechas y números opcionales, "" y null equivalen a "no enviado".
//  • En textos opcionales, "" se respeta (así se puede vaciar un campo al editar).

import { z } from 'zod'

// Mensajes en español, y "es obligatorio" cuando el campo no viene.
z.config({
  ...z.locales.es(),
  customError: (iss) =>
    iss.code === 'invalid_type' && iss.input === undefined ? 'es obligatorio' : undefined,
})

const INT4_MAX = 2_147_483_647

const mensajeNumero = (iss: { input?: unknown }) =>
  iss.input === undefined ? 'es obligatorio' : 'debe ser un número'

// Acepta 5 o "5" o "5.25". Rechaza "abc", NaN, Infinity, null, booleanos.
// Un texto vacío ("" o solo espacios) se trata como "no enviado": un <select>
// sin elegir manda "" y el mensaje correcto es "es obligatorio", no "debe ser un número".
const numeroFlexible = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z
    .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'debe ser un número')], { error: mensajeNumero })
    .transform(Number)
)

export const entero = (min: number, max: number) =>
  numeroFlexible.pipe(
    z.number()
      .int('debe ser un número entero')
      .min(min, `debe ser mayor o igual a ${min}`)
      .max(max, `debe ser menor o igual a ${max}`)
  )

// Identificador de la base de datos (Int de PostgreSQL, positivo).
export const id = numeroFlexible.pipe(
  z.number().int('debe ser un ID válido').positive('debe ser un ID válido').max(INT4_MAX, 'debe ser un ID válido')
)

export const decimal = (min: number, max: number, opts: { minExclusivo?: boolean } = {}) =>
  numeroFlexible.pipe(
    z.number()
      .refine(n => (opts.minExclusivo ? n > min : n >= min),
              opts.minExclusivo ? `debe ser mayor a ${min}` : `debe ser mayor o igual a ${min}`)
      .refine(n => n <= max, `debe ser menor o igual a ${max}`)
  )

export const texto = (max = 255) =>
  z.string({ error: (iss) => (iss.input === undefined ? 'es obligatorio' : 'debe ser texto') })
    .trim()
    .max(max, `máximo ${max} caracteres`)

export const textoReq = (max = 255) => texto(max).min(1, 'es obligatorio')

// Texto opcional: ausente o null = no enviado; "" se respeta.
export const textoOpc = (max = 255) => texto(max).nullish()

export const booleano = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean({ error: 'debe ser verdadero o falso' })
)

export const enumES = <const T extends readonly [string, ...string[]]>(valores: T) =>
  z.enum(valores, { error: () => `debe ser uno de: ${valores.join(', ')}` })

// "" y null cuentan como "no enviado" (útil en fechas, números, selects vacíos).
const vacioAUndefined = (v: unknown) => (v === '' || v === null ? undefined : v)
export const opcional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(vacioAUndefined, schema.optional())

// ─── Fechas ──────────────────────────────────────────────────────────────────
// Date.parse('2026-02-31') NO falla en JavaScript (lo convierte en 3 de marzo),
// por eso el calendario se comprueba a mano.
function fechaExiste(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (y < 1900 || y > 2100) return false
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false
  return !Number.isNaN(Date.parse(s))
}

// AAAA-MM-DD, o ISO completo (AAAA-MM-DDTHH:mm[:ss][.sss][Z|±HH:mm]).
export const fecha = z
  .string({ error: (iss) => (iss.input === undefined ? 'es obligatorio' : 'debe ser una fecha (AAAA-MM-DD)') })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, 'debe ser una fecha (AAAA-MM-DD)')
  .refine(fechaExiste, 'la fecha no existe en el calendario')

// Hora HH:mm (acepta HH:mm:ss y lo normaliza a HH:mm).
export const hora = z
  .string({ error: (iss) => (iss.input === undefined ? 'es obligatorio' : 'debe ser una hora (HH:mm)') })
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'debe ser una hora válida (HH:mm, de 00:00 a 23:59)')
  .transform(s => s.slice(0, 5))

// ─── Contacto / identidad ────────────────────────────────────────────────────
export const ci = textoReq(20)
  .min(3, 'debe tener al menos 3 caracteres')
  .regex(/^[0-9A-Za-z][0-9A-Za-z\-. ]*$/, 'solo letras, números, guion, punto y espacio')

export const telefonoOpc = z
  .union([z.literal(''), z.string().trim().regex(/^[0-9+\-() ]{5,30}$/, 'teléfono inválido (5 a 30 dígitos, + - ( ) permitidos)')])
  .nullish()

export const emailOpc = z
  .union([z.literal(''), z.string().trim().max(150, 'máximo 150 caracteres').pipe(z.email('correo electrónico inválido'))])
  .nullish()

export const username = texto(50)
  .min(3, 'debe tener al menos 3 caracteres')
  .regex(/^\S+$/, 'no puede contener espacios')

// bcrypt solo usa los primeros 72 bytes: más largo no aporta seguridad.
export const passwordNueva = (min: number) =>
  z.string({ error: (iss) => (iss.input === undefined ? 'es obligatorio' : 'debe ser texto') })
    .min(min, `debe tener al menos ${min} caracteres`)
    .max(72, 'debe tener como máximo 72 caracteres')