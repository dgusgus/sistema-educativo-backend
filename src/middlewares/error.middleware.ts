import type { Request, Response, NextFunction } from 'express'
import multer from 'multer'

// Middleware de error — SIEMPRE va último en app.ts, después de montar
// todas las rutas. Captura los errores de asyncHandler y de multer.
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return

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
