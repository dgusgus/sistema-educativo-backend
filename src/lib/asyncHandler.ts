import type { Request, Response, NextFunction, RequestHandler } from 'express'

// Envuelve un controller async: si la promesa rechaza, el error va a
// next() en vez de perderse como una promesa no atrapada — Express no
// hace esto solo con async/await.
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}