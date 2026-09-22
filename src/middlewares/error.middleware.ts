import type { Request, Response, NextFunction } from 'express'

// Middleware de error — SIEMPRE va último en app.ts, después de montar
// todas las rutas. Reemplaza el catch repetido de cada controller.
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  console.error(`[${req.method} ${req.path}]`, err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Error interno del servidor' })
}

/* 
// app.ts — agregar al final, después de todos los app.use('/api/...')
import { errorMiddleware } from './middlewares/error.middleware.js'
app.use(errorMiddleware) */


/* export const getHorarios = async (req: Request, res: Response): Promise<void> => {
  try {
    // ... lógica ...
  } catch (error) {
    console.error('[horario.getHorarios]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

export const getHorarios = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // ... lógica, sin try/catch ...
}) */










/*   // error.middleware.ts — versión con zod
import { ZodError } from 'zod'

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Datos inválidos', detalles: err.issues })
    return
  }
  console.error(`[${req.method} ${req.path}]`, err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Error interno del servidor' })
} */