// src/lib/promedio-final.helper.ts
//
// Promedio final de una materia = promedio de los promedios trimestrales de
// TODOS los trimestres de la gestión, redondeado a 2 decimales (el mismo
// redondeo con el que se guarda en PromedioFinal y se muestra en pantalla,
// para que lo que se ve y lo que se decide nunca difieran).
//
// Dos piezas:
//   · promedioFinalDe()          → la fórmula, pura (la usan el escritor y
//                                   el cálculo del resultado del año).
//   · calcularPromediosFinales() → ÚNICO escritor de PromedioFinal. Se llama
//                                   al cerrar un trimestre Y al corregir una
//                                   calificación de un trimestre ya cerrado
//                                   (antes solo al cerrar, y la corrección
//                                   dejaba el promedio final desactualizado).

import { prisma } from './prisma.js'
import type { Prisma } from '../../prisma/generated/prisma/client.js'

// Acepta el cliente normal o el de una transacción interactiva.
type Db = Prisma.TransactionClient

export const redondear2 = (n: number): number => Math.round(n * 100) / 100

/** null si todavía faltan trimestres (no se puede decidir un promedio final). */
export function promedioFinalDe(promediosTrimestrales: number[], totalTrimestres: number): number | null {
  if (totalTrimestres <= 0 || promediosTrimestrales.length < totalTrimestres) return null
  const suma = promediosTrimestrales.reduce((a, b) => a + b, 0)
  return redondear2(suma / promediosTrimestrales.length)
}

/**
 * Recalcula y guarda el PromedioFinal de cada estudiante de una materia.
 * Solo materializa cuando hay promedio trimestral de TODOS los trimestres de
 * la gestión. Escribe únicamente las filas que cambian (idempotente).
 * Devuelve cuántas filas escribió.
 */
export async function calcularPromediosFinales(
  docenteMateriaCursoId: number,
  gestionId: number,
  db: Db = prisma,
): Promise<number> {
  const totalTrimestres = await db.trimestre.count({ where: { gestionId } })

  const gestion = await db.gestion.findUniqueOrThrow({
    where: { id: gestionId }, select: { notaMinimaAprobacion: true },
  })
  const notaMinima = Number(gestion.notaMinimaAprobacion)

  const calificaciones = await db.calificacion.findMany({
    where:  { docenteMateriaCursoId, promedioTrimestral: { not: null } },
    select: { inscripcionId: true, trimestreId: true, promedioTrimestral: true },
  })

  // inscripción → (trimestre → promedio). El mapa por trimestre evita contar
  // dos veces un trimestre si algún día hubiera filas repetidas.
  const porInscripcion = new Map<number, Map<number, number>>()
  for (const cal of calificaciones) {
    const trimestres = porInscripcion.get(cal.inscripcionId) ?? new Map<number, number>()
    trimestres.set(cal.trimestreId, Number(cal.promedioTrimestral))
    porInscripcion.set(cal.inscripcionId, trimestres)
  }

  const existentes = await db.promedioFinal.findMany({
    where:  { docenteMateriaCursoId },
    select: { inscripcionId: true, promedioFinal: true, resultado: true },
  })
  const actual = new Map(existentes.map(e => [e.inscripcionId, e]))

  let escritas = 0
  for (const [inscripcionId, trimestres] of porInscripcion) {
    const promedioFinal = promedioFinalDe([...trimestres.values()], totalTrimestres)
    if (promedioFinal === null) continue // faltan trimestres

    const resultado: 'PROMOVIDO' | 'REPROBADO' = promedioFinal >= notaMinima ? 'PROMOVIDO' : 'REPROBADO'

    const previo = actual.get(inscripcionId)
    if (previo && Number(previo.promedioFinal) === promedioFinal && previo.resultado === resultado) continue

    await db.promedioFinal.upsert({
      where:  { inscripcionId_docenteMateriaCursoId: { inscripcionId, docenteMateriaCursoId } },
      update: { promedioFinal, resultado },
      create: { inscripcionId, docenteMateriaCursoId, promedioFinal, resultado },
    })
    escritas++
  }
  return escritas
}