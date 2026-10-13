// src/services/evaluacion.service.ts
//
// Lógica de negocio del registro de notas. El controller solo traduce HTTP
// (lee req, llama aquí, responde); NO conoce Prisma ni las reglas.
//
// ¿Para qué? (patrón Controller → Service)
//  • El service NO sabe qué es Request/Response: se puede llamar desde un controller,
//    un script de importación, un cron o un test sin simular HTTP.
//  • Las reglas ("trimestre cerrado", "nota ≤ máximo", "el estudiante pertenece al curso")
//    viven en UN lugar. Antes registrarNotasActividad las mezclaba con res.status(...).

import { prisma } from '../lib/prisma.js'
import { recalcularCalificaciones, type PromedioCalculado } from '../lib/calificacion.helper.js'
import { validarContextoAcademicoLote } from '../lib/contexto-academico.helper.js'
import { ErrorDeUsuario, NoEncontrado, Prohibido } from '../lib/errores.js'

export interface NotaEntrada {
  inscripcionId: number
  nota:          number
  observacion?:  string | undefined
}

// Carga la actividad con lo necesario para decidir permisos y reglas.
export async function obtenerActividadParaNotas(actividadEvaluativaId: number) {
  const actividad = await prisma.actividadEvaluativa.findUnique({
    where:   { id: actividadEvaluativaId },
    include: { trimestre: { select: { cerrado: true } } },
  })
  if (!actividad) throw new NoEncontrado('Actividad evaluativa')
  return actividad
}

export async function registrarNotas(
  actividad: Awaited<ReturnType<typeof obtenerActividadParaNotas>>,
  notas: NotaEntrada[],
  registradoPorId: number,
): Promise<{ registradas: number; resultados: PromedioCalculado[] }> {
  if (actividad.trimestre.cerrado) {
    throw new Prohibido('El trimestre está cerrado — no se pueden modificar notas')
  }

  // Nota dentro del rango de ESTA actividad (depende del dato guardado, por eso
  // no puede vivir solo en el schema zod de la ruta).
  const maximo = Number(actividad.puntajeMaximo)
  const fueraDeRango = notas.find(n => n.nota < 0 || n.nota > maximo)
  if (fueraDeRango) {
    throw new ErrorDeUsuario(`Nota inválida: ${fueraDeRango.nota}. El máximo de esta actividad es ${maximo}`)
  }

  // ✅ Faltaba: sin esto un docente podía enviar el inscripcionId de un estudiante de
  // OTRO curso o gestión y se creaba una NotaActividad que contaminaba sus promedios.
  // (El propio contexto-academico.helper.ts decía que este era un punto obligatorio.)
  const { invalidas, error } = await validarContextoAcademicoLote(
    notas.map(n => n.inscripcionId), actividad.docenteMateriaCursoId, actividad.trimestreId,
  )
  if (error) throw new ErrorDeUsuario(error)
  if (invalidas.length > 0) {
    throw new ErrorDeUsuario(
      'Alguna(s) inscripción(es) no pertenecen al curso/gestión de esta actividad',
      400,
      { inscripcionesInvalidas: invalidas },
    )
  }

  // Notas + recálculo en UNA transacción lógica: si el recálculo falla, las notas
  // ya guardadas quedan (son el dato fuente) y el recálculo se puede repetir; pero
  // las notas en sí se guardan todas o ninguna.
  await prisma.$transaction(
    notas.map(n =>
      prisma.notaActividad.upsert({
        where:  { actividadEvaluativaId_inscripcionId: { actividadEvaluativaId: actividad.id, inscripcionId: n.inscripcionId } },
        update: { nota: n.nota, observacion: n.observacion, registradoPorId },
        create: {
          actividadEvaluativaId: actividad.id, inscripcionId: n.inscripcionId,
          nota: n.nota, observacion: n.observacion, registradoPorId,
        },
      })
    )
  )

  const resultados = await recalcularCalificaciones(
    notas.map(n => n.inscripcionId), actividad.docenteMateriaCursoId, actividad.trimestreId,
  )
  return { registradas: notas.length, resultados }
}

// Baja lógica de una actividad evaluativa + recálculo de los promedios afectados.
export async function desactivarActividad(actividad: Awaited<ReturnType<typeof obtenerActividadParaNotas>>) {
  if (actividad.trimestre.cerrado) {
    throw new Prohibido('El trimestre está cerrado — no se pueden modificar actividades')
  }

  const desactivada = await prisma.actividadEvaluativa.update({
    where: { id: actividad.id },
    data:  { activo: false },
  })

  // Los estudiantes que tenían nota en esta actividad deben recalcular su promedio
  // (calcularPromedioTrimestral solo considera actividades activas).
  const conNota = await prisma.notaActividad.findMany({
    where:  { actividadEvaluativaId: actividad.id },
    select: { inscripcionId: true },
  })
  await recalcularCalificaciones(conNota.map(n => n.inscripcionId), actividad.docenteMateriaCursoId, actividad.trimestreId)

  return desactivada
}
