// src/schemas/inscripcion.schema.ts
import { z } from 'zod'
import { enumES, id, textoOpc, opcional, fecha } from './common.schema.js'

export const inscribirEstudianteSchema = z.object({
  estudianteId: id,
  cursoId:      id,
  gestionId:    id,
  procedencia:  textoOpc(255),
})

export const registrarResultadoSchema = z.object({
  resultado:     enumES(['PROMOVIDO', 'REPROBADO']),
  observaciones: textoOpc(500),
})

export const cambiarEstadoInscripcionSchema = z.object({
  estadoInscripcion: enumES(['ACTIVA', 'RETIRADA', 'TRANSFERIDA', 'CONCLUIDA']),
  fechaRetiro:       opcional(fecha),
  observaciones:     textoOpc(500),
})