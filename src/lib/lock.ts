// src/lib/lock.ts
//
// Bloqueo de aviso (advisory lock) de PostgreSQL, atado a la TRANSACCIÓN.
//
// ¿Para qué? Dos peticiones iguales a la vez (doble clic, dos pestañas, un reintento
// del navegador) leen el mismo estado, deciden lo mismo y escriben las dos. Donde la
// base tiene una restricción única, la segunda falla con error; donde NO la tiene
// (p. ej. ConceptoPago) se duplican los datos sin avisar. El bloqueo hace que la
// segunda petición ESPERE a que termine la primera y luego vea su resultado, así que
// responde "ya existía" en vez de duplicar o fallar.
//
// Reglas de uso:
//   • Llamar SIEMPRE dentro de prisma.$transaction (el bloqueo se libera solo al
//     hacer commit/rollback). Fuera de una transacción no protege nada.
//   • La clave describe la operación y los datos que toca, p. ej.
//     `promocion:matricular:${origenId}:${destinoId}`: operaciones sobre otras
//     gestiones no se bloquean entre sí.
//   • Va PRIMERO en el servicio, antes de leer lo que se va a decidir.
import type { Prisma } from '../../prisma/generated/prisma/client.js'

export async function bloquearTransaccion(db: Prisma.TransactionClient, clave: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clave}, 0))`
}
