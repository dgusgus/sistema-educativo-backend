// src/schemas/auth.schema.ts
import { z } from 'zod'
import { passwordNueva, textoReq } from './common.schema.js'

// La contraseña del login NO se recorta ni se limita a 72: solo se comprueba que exista.
// (El username sí se recorta: un espacio al copiar/pegar no debe impedir entrar.)
export const loginSchema = z.object({
  username: textoReq(100),
  password: z.string({ error: 'es obligatorio' }).min(1, 'es obligatorio').max(200, 'demasiado larga'),
})

export const cambiarPasswordSchema = z.object({
  passwordActual: z.string({ error: 'es obligatorio' }).min(1, 'es obligatorio').max(200, 'demasiado larga'),
  passwordNueva:  passwordNueva(8),
})