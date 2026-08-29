import { Rol } from '../../prisma/generated/prisma/enums.ts'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number
        roles: Rol[]
        username: string
        nombre: string
      }
    }
  }
}