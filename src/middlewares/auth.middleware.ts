import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { Rol } from '../../prisma/generated/prisma/enums.js'

interface JwtPayload {
  id: number
  rol: Rol
  username: string
  nombre: string
}

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token no proporcionado' })
    return
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET ?? 'secret'
    ) as JwtPayload

    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}