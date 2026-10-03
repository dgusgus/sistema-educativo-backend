// src/schemas/horario.schema.ts
import { z } from 'zod'
import { enumES, hora, id, opcional, textoOpc } from './common.schema.js'

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'] as const

// El controlador convierte "HH:mm" con new Date(`1970-01-01T${hhmm}:00Z`): una hora
// como "25:99" daba Invalid Date y terminaba en error 500. Ahora se rechaza aquí.
const finPosterior = (o: { horaInicio?: string; horaFin?: string }) =>
  o.horaInicio === undefined || o.horaFin === undefined || o.horaFin > o.horaInicio   // "HH:mm" se ordena como texto

export const createHorarioSchema = z
  .object({
    docenteMateriaCursoId: id,
    diaSemana:             enumES(DIAS),
    horaInicio:            hora,
    horaFin:               hora,
    aula:                  textoOpc(50),
  })
  .refine(finPosterior, { message: 'horaFin debe ser posterior a horaInicio', path: ['horaFin'] })

export const updateHorarioSchema = z
  .object({
    diaSemana:  opcional(enumES(DIAS)),
    horaInicio: opcional(hora),
    horaFin:    opcional(hora),
    aula:       textoOpc(50),
  })
  .refine(finPosterior, { message: 'horaFin debe ser posterior a horaInicio', path: ['horaFin'] })