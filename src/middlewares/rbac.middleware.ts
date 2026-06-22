import { Request, Response, NextFunction } from 'express'
import type { Rol } from '../../prisma/generated/prisma/enums.js'

export const requireRol = (...roles: Rol[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' })
      return
    }
    if (!roles.includes(req.user.rol)) {
      res.status(403).json({ error: 'Sin permisos para esta acción' })
      return
    }
    next()
  }
}