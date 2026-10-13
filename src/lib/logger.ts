// src/lib/logger.ts
//
// Logger estructurado (pino) en lugar de console.log / console.error.
//
// ¿Para qué?
//  • console.error('[x]', error) imprime texto libre: no se puede filtrar por nivel,
//    por usuario ni por request, y en producción no hay forma de buscar "todos los
//    errores del usuario 42 de ayer".
//  • pino escribe JSON (1 línea = 1 evento) con nivel, hora y los campos que le pases.
//    Cualquier herramienta (Loki, Datadog, CloudWatch, `jq`) lo entiende.
//  • `redact` garantiza que contraseñas y tokens NUNCA queden en los logs aunque
//    alguien los loguee por accidente.
//
// Uso:  logger.error({ err, usuarioId }, 'No se pudo cerrar el trimestre')
//       req.log.info(...)   ← dentro de un controller: ya trae el id de la request.

import pino from 'pino'
import { config } from './config.js'

export const logger = pino({
  level: config.esTest ? 'silent' : config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.passwordActual',
      '*.passwordNueva',
    ],
    censor: '[REDACTADO]',
  },
  // En desarrollo, salida legible: `pnpm dev | pino-pretty`
  // (en producción se deja JSON puro).
})
