// src/lib/config.ts
//
// TODA la configuración del servidor se lee y valida AQUÍ, una sola vez, al arrancar.
//
// ¿Por qué? Antes cada archivo leía su propio `process.env.X ?? valorPorDefecto`:
//   • prisma.ts hacía `DATABASE_URL ?? ''` → si faltaba, el servidor arrancaba y
//     fallaba recién en la primera consulta, con un error críptico.
//   • app.ts leía FRONTEND_URL, TRUST_PROXY; server.ts leía PORT...
// Con un solo lugar: si algo falta o está mal, el servidor NO arranca y el mensaje
// dice exactamente qué variable corregir ("fail fast"). Además el resto del código
// importa `config.port` (tipado) en vez de adivinar si `process.env.PORT` es string.
//
// Se mantienen los exports JWT_SECRET y JWT_EXPIRES_IN para no tocar token.helper.ts
// ni auth.middleware.ts.

import 'dotenv/config'
import { z } from 'zod'

const SECRETOS_DEBILES = new Set(['secret', 'changeme', 'tu_secreto_jwt_aqui'])

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT:     z.coerce.number().int().min(1).max(65535).default(4000),

  DATABASE_URL: z
    .string({ error: 'falta DATABASE_URL' })
    .min(1, 'DATABASE_URL está vacía')
    .refine(v => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL debe empezar con postgresql://'),

  JWT_SECRET: z
    .string({ error: 'falta JWT_SECRET' })
    .min(32, 'JWT_SECRET debe tener mínimo 32 caracteres')
    .refine(v => !SECRETOS_DEBILES.has(v), 'JWT_SECRET no puede ser el valor de ejemplo'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // Uno o varios orígenes permitidos por CORS, separados por coma.
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // Cantidad de proxies delante (1 = nginx/Render/Railway). Vacío = sin proxy.
  TRUST_PROXY: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

function leerConfig() {
  const resultado = envSchema.safeParse(process.env)
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map(i => `  • ${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('\n')
    throw new Error(
      `[config] Variables de entorno inválidas. El servidor no puede arrancar:\n${problemas}\n` +
      'Para generar un JWT_SECRET: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    )
  }
  const env = resultado.data
  return {
    nodeEnv:      env.NODE_ENV,
    esProduccion: env.NODE_ENV === 'production',
    esTest:       env.NODE_ENV === 'test',
    port:         env.PORT,
    databaseUrl:  env.DATABASE_URL,
    jwtSecret:    env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    corsOrigins:  env.FRONTEND_URL.split(',').map(o => o.trim()).filter(Boolean),
    trustProxy:   env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : null,
    logLevel:     env.LOG_LEVEL,
  } as const
}

export const config = leerConfig()

// Compatibilidad con el código existente
export const JWT_SECRET     = config.jwtSecret
export const JWT_EXPIRES_IN = config.jwtExpiresIn
