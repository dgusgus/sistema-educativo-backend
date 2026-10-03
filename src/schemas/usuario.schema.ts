// src/schemas/usuario.schema.ts
import { z } from 'zod'
import {
  booleano, enumES, id, opcional, passwordNueva, textoOpc, username,
} from './common.schema.js'
import { personaSchema } from './persona.schema.js'

export const ROLES = ['DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'] as const

// Arreglo de roles: al menos uno, solo valores válidos, sin repetidos.
const roles = z
  .array(enumES(ROLES), { error: (iss) => (iss.input === undefined ? 'es obligatorio' : 'debe ser un arreglo de roles') })
  .min(1, 'debe incluir al menos un rol')
  .max(ROLES.length, 'demasiados roles')
  .transform(r => [...new Set(r)])

export const createUsuarioSchema = z.object({
  username,
  password: passwordNueva(6),
  roles,
})

export const updateUsuarioSchema = z
  .object({
    roles:  roles.optional(),
    activo: booleano.optional(),
  })
  .refine(o => o.roles !== undefined || o.activo !== undefined, {
    message: 'Debes enviar al menos "roles" o "activo"',
    path: ['roles'],
  })

export const resetearPasswordSchema = z.object({
  nuevaPassword: passwordNueva(6),
})

export const vincularPerfilSchema = z
  .object({
    docenteId:    opcional(id),
    estudianteId: opcional(id),
    tutorId:      opcional(id),
  })
  .refine(o => o.docenteId !== undefined || o.estudianteId !== undefined || o.tutorId !== undefined, {
    message: 'Debes enviar docenteId, estudianteId o tutorId',
    path: ['docenteId'],
  })

// Datos extra según el rol (ver DatosPorRol en lib/persona.helper.ts).
const datosPorRol = z.object({
  DIRECTOR:   z.object({ gestionId: opcional(id) }).optional(),
  SECRETARIA: z.object({}).optional(),
  DOCENTE:    z.object({ especialidad: textoOpc(100) }).optional(),
  ESTUDIANTE: z.object({
    rude:             textoOpc(30),
    lugarNacimiento:  textoOpc(100),
    idiomaMaterno:    textoOpc(60),
    idiomaHablado:    textoOpc(60),
    discapacidad:     booleano.optional(),
    tipoDiscapacidad: textoOpc(100),
  }).optional(),
  TUTOR: z.object({
    ocupacion:        textoOpc(100),
    gradoInstruccion: textoOpc(100),
  }).optional(),
})

export const createUsuarioConPerfilSchema = z.object({
  roles,
  username,
  password:    passwordNueva(6),
  persona:     personaSchema,
  datosPorRol: datosPorRol.optional(),
})