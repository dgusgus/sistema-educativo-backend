import type { Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { ZodError } from 'zod'
import { ErrorDeUsuario } from '../lib/errores.js'

// Middleware de error — SIEMPRE va último en app.ts, después de montar
// todas las rutas. Captura los errores de asyncHandler y de multer.
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return

  // Error con mensaje pensado para el usuario (archivo inválido, datos mal puestos...)
  if (err instanceof ErrorDeUsuario) {
    res.status(err.status).json({ error: err.message })
    return
  }

  // Un ZodError que se escape de un controlador (schema.parse) es un dato
  // inválido del cliente, no un fallo del servidor.
  if (err instanceof ZodError) {
    const detalles = err.issues.map(i => ({ campo: i.path.join('.') || '(cuerpo)', mensaje: i.message }))
    res.status(400).json({ error: `${detalles[0].campo}: ${detalles[0].mensaje}`, detalles })
    return
  }

  // Errores de express.json(): antes terminaban como 500.
  const tipo = typeof err === 'object' && err !== null ? (err as { type?: string }).type : undefined
  if (tipo === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido' })
    return
  }
  if (tipo === 'entity.too.large') {
    res.status(413).json({ error: 'El cuerpo de la petición es demasiado grande' })
    return
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message === 'File too large' ? 'El archivo supera los 5MB' : err.message })
    return
  }
  if (err instanceof Error && err.message.includes('.xlsx')) {
    res.status(400).json({ error: err.message })
    return
  }

  console.error(`[${req.method} ${req.path}]`, err)
  res.status(500).json({ error: 'Error interno del servidor' })
}