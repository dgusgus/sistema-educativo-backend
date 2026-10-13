// src/middlewares/limite.middleware.ts
//
// Límite de peticiones POR USUARIO para endpoints pesados (copiar estructura,
// matricular en lote, registrar resultados).
//
// ¿Por qué por usuario y no por IP? En un colegio muchas personas comparten la IP
// (wifi/NAT): un límite por IP bloquearía a la secretaría porque el director hizo
// pruebas. Por usuario, cada cuenta tiene su propio cupo. Va DESPUÉS de authMiddleware
// (necesita req.user).
import rateLimit from 'express-rate-limit'
import type { RequestHandler } from 'express'

interface OpcionesLimite {
  max: number
  ventanaMin: number
  mensaje?: string
  /** Solo para probar el límite: en los tests de integración se desactiva (comparten usuario id=1 entre casos). */
  activoEnTest?: boolean
}

export function limitePorUsuario({ max, ventanaMin, mensaje, activoEnTest = false }: OpcionesLimite): RequestHandler {
  return rateLimit({
    windowMs: ventanaMin * 60 * 1000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    // Sin usuario no debería llegar aquí (auth va antes); el respaldo evita un cupo compartido.
    skip: () => process.env.VITEST === 'true' && !activoEnTest,
    keyGenerator: (req) => `u:${req.user?.id ?? 'anon'}`,
    message: { error: mensaje ?? 'Demasiadas operaciones seguidas. Espera unos minutos e inténtalo de nuevo.' },
    validate: { keyGeneratorIpFallback: false },
  })
}
