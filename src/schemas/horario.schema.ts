// src/schemas/horario.schema.ts (ejemplo con el módulo que ya armamos)
import { z } from 'zod'

export const horarioPayloadSchema = z.object({
  docenteMateriaCursoId: z.number().int().positive(),
  diaSemana: z.enum(['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO']),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:mm'),
  horaFin: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:mm'),
  aula: z.string().optional(),
})

// El tipo sale GRATIS del schema — nunca más se desincroniza con la validación
export type HorarioPayload = z.infer<typeof horarioPayloadSchema>

/* 
// en el controller
export const createHorario = asyncHandler(async (req: Request, res: Response) => {
  const datos = horarioPayloadSchema.parse(req.body)   // lanza ZodError si algo está mal
  // ... acá `datos` ya está tipado y validado, sin ifs manuales
}) */