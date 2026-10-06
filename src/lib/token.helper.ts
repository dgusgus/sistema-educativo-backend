// src/lib/token.helper.ts
//
// Emisión de tokens en UN solo lugar (login y cambio de contraseña).
//
// "pv" (password version) es una huella de la contraseña vigente, calculada
// con HMAC para no exponer el hash dentro del token. El middleware la compara
// con la de la base de datos en cada request:
//   • si la contraseña cambia o se resetea → la huella cambia → todos los
//     tokens emitidos antes quedan inválidos al instante.
// Se eligió esto en vez de una columna "tokenVersion" para NO requerir una
// migración de base de datos.

import { createHmac } from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'
import type { Rol } from '../../prisma/generated/prisma/enums.js'
import { JWT_SECRET, JWT_EXPIRES_IN } from './config.js'

export function huellaPassword(passwordHash: string): string {
  return createHmac('sha256', JWT_SECRET).update(passwordHash).digest('hex').slice(0, 16)
}

export function firmarToken(u: {
  id: number
  roles: Rol[]
  username: string
  nombre: string
  passwordHash: string
}): string {
  return jwt.sign(
    { id: u.id, roles: u.roles, username: u.username, nombre: u.nombre, pv: huellaPassword(u.passwordHash) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'] }
  )
}