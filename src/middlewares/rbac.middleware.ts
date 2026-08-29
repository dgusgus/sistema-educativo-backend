import { Request, Response, NextFunction } from 'express'
import type { Rol } from '../../prisma/generated/prisma/enums.js'

// Antes: comparaba req.user.rol (uno solo) contra la lista permitida.
// Ahora: req.user.roles es un arreglo — basta con que el usuario tenga
// AL MENOS UNO de los roles permitidos para la ruta.
export const requireRol = (...rolesPermitidos: Rol[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' })
      return
    }
    const tieneAcceso = req.user.roles.some(r => rolesPermitidos.includes(r))
    if (!tieneAcceso) {
      res.status(403).json({ error: 'Sin permisos para esta acción' })
      return
    }
    next()
  }
}