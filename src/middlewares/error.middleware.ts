import type { Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { ZodError } from 'zod'
import { ErrorDeUsuario } from '../lib/errores.js'
import { logger } from '../lib/logger.js'

// ─── 404 para rutas que no existen ────────────────────────────────────────────
// Antes, una URL mal escrita devolvía la página HTML por defecto de Express; el
// frontend (que espera JSON) fallaba al parsearla. Va ANTES del errorMiddleware.
export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` })
}

// Errores conocidos de Prisma, identificados por su `code` (sin importar la clase,
// así este archivo no depende del cliente generado y es fácil de testear).
//   P2002  violación de UNIQUE      → 409 (antes: 500)
//   P2025  registro no encontrado   → 404 (antes: 500; p. ej. update/delete de un id inexistente)
//   P2003  violación de FK          → 409 (antes: 500; p. ej. borrar algo que otra tabla referencia)
function respuestaPrisma(err: unknown): { status: number; error: string } | null {
  if (typeof err !== 'object' || err === null) return null
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string' || !/^P\d{4}$/.test(code)) return null

  switch (code) {
    case 'P2002': return { status: 409, error: 'Ya existe un registro con esos datos' }
    case 'P2025': return { status: 404, error: 'El registro solicitado no existe' }
    case 'P2003': return { status: 409, error: 'La operación viola una relación con otros datos (hay registros que dependen de este)' }
    default:      return null   // otros P2xxx son errores reales del servidor → 500
  }
}

// Middleware de error — SIEMPRE va último en app.ts, después de montar todas las
// rutas. En Express 5 también recibe los errores de handlers async (rechazos de
// promesa), por eso los controllers ya no necesitan try/catch.
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return

  // 1) Error con mensaje pensado para el usuario
  if (err instanceof ErrorDeUsuario) {
    res.status(err.status).json({ error: err.message, ...err.extra })
    return
  }

  // 2) Datos inválidos que escaparon a la validación de la ruta
  if (err instanceof ZodError) {
    const detalles = err.issues.map(i => ({ campo: i.path.join('.') || '(cuerpo)', mensaje: i.message }))
    res.status(400).json({ error: `${detalles[0].campo}: ${detalles[0].mensaje}`, detalles })
    return
  }

  // 3) Errores del parser de JSON
  const tipo = typeof err === 'object' && err !== null ? (err as { type?: string }).type : undefined
  if (tipo === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido' })
    return
  }
  if (tipo === 'entity.too.large') {
    res.status(413).json({ error: 'El cuerpo de la petición es demasiado grande' })
    return
  }

  // 4) Subida de archivos
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera los 5 MB' : err.message })
    return
  }

  // 5) Errores conocidos de la base de datos
  const prisma = respuestaPrisma(err)
  if (prisma) {
    logger.warn({ err, reqId: req.id, metodo: req.method, ruta: req.originalUrl, usuarioId: req.user?.id }, 'Error de base de datos controlado')
    res.status(prisma.status).json({ error: prisma.error })
    return
  }

  // 6) Todo lo demás es un fallo del servidor: se registra con contexto para
  //    poder reproducirlo, pero al cliente NUNCA se le muestra el detalle.
  logger.error(
    { err, reqId: req.id, metodo: req.method, ruta: req.originalUrl, usuarioId: req.user?.id },
    'Error no controlado'
  )
  res.status(500).json({ error: 'Error interno del servidor', ...(req.id ? { referencia: String(req.id) } : {}) })
}
