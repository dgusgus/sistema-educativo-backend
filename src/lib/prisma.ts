import { PrismaClient, Prisma } from '../../prisma/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

// ⚠️ FIX GLOBAL: decimal.js (la librería que usa Prisma por debajo para el
// tipo Decimal) define su propio toJSON() devolviendo un STRING
// (Decimal.toString()), no un número. Eso significa que TODO campo Decimal
// del schema —promedioTrimestral, promedio, nota, peso, pesoEnPromedio,
// monto, montoPagado, montoOriginal, descuento, notaMinimaAprobacion...—
// le llega al frontend como "45.50" en vez de 45.5, aunque el tipo de
// TypeScript diga `number`. Ahí es donde revientan cosas como
// `item.promedio.toFixed(1)` ("promedio.toFixed is not a function").
//
// Se pisa el toJSON acá, UNA sola vez, para que sea Number en vez de
// String — soluciona el problema en el origen para toda la app, sin
// tocar un solo controller.
// El cast es necesario porque el toJSON original de decimal.js está
// tipado para devolver string — acá lo estamos cambiando a propósito.
(Prisma.Decimal.prototype as unknown as { toJSON(): number }).toJSON = function (
  this: InstanceType<typeof Prisma.Decimal>
) {
  return this.toNumber()
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? '',
})

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}