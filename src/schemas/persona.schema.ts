// src/schemas/persona.schema.ts
//
// Datos de persona compartidos por Estudiante, Docente, Tutor, Director,
// Secretaria y por la creación de usuario con perfil.

import { z } from 'zod'
import {
  booleano, ci, emailOpc, enumES, fecha, id, opcional, passwordNueva,
  telefonoOpc, textoOpc, textoReq, username,
} from './common.schema.js'

export const PARENTESCOS = ['PADRE', 'MADRE', 'ABUELO', 'ABUELA', 'TIO', 'TIA', 'HERMANO', 'HERMANA', 'TUTOR_LEGAL', 'OTRO'] as const

// Campos de Persona (los mismos que PersonaInput en lib/persona.helper.ts).
const camposPersona = {
  ci,
  nombre:          textoReq(100),
  apellido:        textoReq(100),
  sexo:            opcional(enumES(['MASCULINO', 'FEMENINO'])),
  fechaNacimiento: opcional(fecha),
  direccion:       textoOpc(255),
  telefono:        telefonoOpc,
  email:           emailOpc,
  nacionalidad:    textoOpc(60),
  fotoUrl:         textoOpc(500),
}

// Persona anidada (createUsuarioConPerfil): ci, nombre y apellido obligatorios.
export const personaSchema = z.object(camposPersona)

// Persona "plana" en el cuerpo (crear estudiante/docente/tutor): mismos campos.
const personaPlana = z.object(camposPersona)
// Edición: todo opcional.
const personaParcial = z.object(camposPersona).partial()

// ─── Estudiante ──────────────────────────────────────────────────────────────
export const createEstudianteSchema = personaPlana.extend({
  rude: textoOpc(30),
})
export const updateEstudianteSchema = personaParcial.extend({
  rude:   textoOpc(30),
  activo: booleano.optional(),
})

// ─── Docente ─────────────────────────────────────────────────────────────────
export const createDocenteSchema = personaPlana.extend({
  especialidad: textoOpc(100),
})
export const updateDocenteSchema = personaParcial.extend({
  especialidad: textoOpc(100),
  activo:       booleano.optional(),
})
export const asignarMateriaCursoSchema = z.object({
  materiaId: id,
  cursoId:   id,
  gestionId: id,
})

// ─── Tutor ───────────────────────────────────────────────────────────────────
const camposTutor = {
  ocupacion:        textoOpc(100),
  gradoInstruccion: textoOpc(100),
}
export const createTutorSchema = personaPlana.extend(camposTutor)
export const updateTutorSchema = personaParcial.extend(camposTutor)

// El frontend/Excel a veces manda "madre" en minúsculas: se normaliza.
const parentesco = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
  enumES(PARENTESCOS)
)
export const vincularEstudianteSchema = z.object({
  parentesco,
  esTutorPrincipal:  booleano.optional(),
  esApoderado:       booleano.optional(),
  viveConEstudiante: booleano.optional(),
})

// ─── Director / Secretaria ───────────────────────────────────────────────────
const camposCuenta = {
  username,
  password: passwordNueva(6),
}
export const createDirectorConCuentaSchema = personaPlana.extend({
  ...camposCuenta,
  gestionId: opcional(id),
})
export const updateDirectorSchema = personaParcial.extend({ activo: booleano.optional() })
export const asignarCuentaSchema = z.object({ usuarioId: id })

export const createSecretariaConCuentaSchema = personaPlana.extend(camposCuenta)
export const updateSecretariaSchema = personaParcial.extend({ activo: booleano.optional() })