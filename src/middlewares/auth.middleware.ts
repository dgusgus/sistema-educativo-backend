import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { Rol } from '../../prisma/generated/prisma/enums.js'
import { JWT_SECRET } from '../lib/config.js'
import { prisma } from '../lib/prisma.js'
import { huellaPassword } from '../lib/token.helper.js'

interface JwtPayload {
  id: number
  roles: Rol[]
  username: string
  nombre: string
  pv?: string
}

// Además de verificar la firma del token, consulta al usuario en la BD
// (una búsqueda por clave primaria, muy barata) para que los cambios
// surtan efecto AL INSTANTE y no cuando el token venza (8 h):
//   • cuenta desactivada o eliminada  → 401
//   • contraseña cambiada/reseteada   → 401 (el token viejo deja de servir)
//   • roles modificados               → se usan los roles ACTUALES de la BD,
//                                       no los que el token traía
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token no proporcionado' })
    return
  }

  const token = authHeader.split(' ')[1]

  let payload: JwtPayload
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
    return
  }

  if (!Number.isInteger(payload.id)) {
    res.status(401).json({ error: 'Token inválido o expirado' })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where:  { id: payload.id },
      select: { username: true, roles: true, activo: true, passwordHash: true },
    })

    if (!usuario || !usuario.activo) {
      res.status(401).json({ error: 'Sesión inválida o cuenta desactivada' })
      return
    }

    // Los tokens emitidos antes de esta versión no traen "pv": se rechazan
    // y el usuario vuelve a iniciar sesión una sola vez.
    if (payload.pv !== huellaPassword(usuario.passwordHash)) {
      res.status(401).json({ error: 'Sesión expirada. Inicia sesión nuevamente' })
      return
    }

    req.user = {
      id:       payload.id,
      roles:    usuario.roles,
      username: usuario.username,
      nombre:   payload.nombre,
    }
    next()
  } catch (error) {
    // Si la BD falla NO es un 401 (el token es válido): es un error del servidor.
    console.error('[authMiddleware]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}