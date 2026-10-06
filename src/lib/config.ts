// src/lib/config.ts
//
// Configuración crítica leída UNA sola vez, al arrancar.
//
// ¿Por qué? Antes el código hacía `process.env.JWT_SECRET ?? 'secret'` en dos
// lugares. Si en el servidor la variable faltaba (mal copiado el .env, mal
// configurado el hosting), la app arrancaba igual firmando los tokens con
// "secret", un valor que cualquiera puede adivinar: con eso se fabrica un
// token de DIRECTOR sin conocer ninguna contraseña.
//
// Ahora, si falta o es débil, el servidor NO arranca y el error es evidente.

import 'dotenv/config'

const SECRETOS_DEBILES = new Set([
  'secret',
  'changeme',
  'tu_secreto_jwt_aqui',   // el valor de ejemplo de .env.example
])

function leerJwtSecret(): string {
  const secreto = process.env.JWT_SECRET

  if (!secreto) {
    throw new Error('[config] Falta JWT_SECRET en las variables de entorno. El servidor no puede arrancar sin él.')
  }
  if (SECRETOS_DEBILES.has(secreto) || secreto.length < 32) {
    throw new Error(
      '[config] JWT_SECRET es débil (mínimo 32 caracteres y distinto del ejemplo). ' +
      'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    )
  }
  return secreto
}

export const JWT_SECRET     = leerJwtSecret()
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '8h'