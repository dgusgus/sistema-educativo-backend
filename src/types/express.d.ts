import { Rol } from '../../prisma/generated/prisma/enums.ts'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number
        rol: Rol
        username: string
      }
    }
  }
}