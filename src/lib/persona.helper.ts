// src/lib/persona.helper.ts
//
// v6 movió nombre/apellido/ci/telefono/email/etc. a una tabla Persona
// compartida entre Director/Secretaria/Docente/Estudiante/Tutor. Este
// archivo centraliza lo que antes cada controller hacía "a mano":
//   1. crear la Persona
//   2. crear los N perfiles de rol (ahora Usuario.roles es un arreglo,
//      así que un mismo usuario puede tener Director + Docente a la vez)
//   3. aplanar `perfil.persona.nombre` -> `perfil.nombre` para no romper
//      lo que ya consume el frontend

import { prisma } from './prisma.js'
import { ErrorDeUsuario } from './errores.js'
import type { Rol } from '../../prisma/generated/prisma/enums.js'

// ─── Persona ────────────────────────────────────────────────────────────────

export const personaSelect = {
  id:              true,
  ci:              true,
  nombre:          true,
  apellido:        true,
  sexo:            true,
  fechaNacimiento: true,
  direccion:       true,
  telefono:        true,
  email:           true,
  nacionalidad:    true,
  fotoUrl:         true,
} as const

export interface PersonaInput {
  ci: string
  nombre: string
  apellido: string
  sexo?: 'MASCULINO' | 'FEMENINO'
  fechaNacimiento?: string | Date
  direccion?: string
  telefono?: string
  email?: string
  nacionalidad?: string
  fotoUrl?: string
}

// Valida los campos obligatorios de Persona. Devuelve un mensaje de
// error o null si está todo bien.
export function validarPersona(persona: Partial<PersonaInput> | undefined): string | null {
  if (!persona) return 'El campo persona es obligatorio'
  if (!persona.ci)       return 'persona.ci es obligatorio'
  if (!persona.nombre)   return 'persona.nombre es obligatorio'
  if (!persona.apellido) return 'persona.apellido es obligatorio'
  return null
}

// tx acepta tanto `prisma` como el cliente de una transacción — ambos
// exponen `.persona`, `.docente`, etc. con la misma forma.
export async function crearPersona(tx: any, data: PersonaInput) {
  return tx.persona.create({
    data: {
      ci:              data.ci,
      nombre:          data.nombre,
      apellido:        data.apellido,
      sexo:            data.sexo,
      fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento) : undefined,
      direccion:       data.direccion,
      telefono:        data.telefono,
      email:           data.email,
      nacionalidad:    data.nacionalidad,
      fotoUrl:         data.fotoUrl,
    },
  })
}

// El CI ahora es único a nivel de Persona (una sola tabla), ya no hay
// que revisar Director/Docente/Estudiante/... por separado.
export async function buscarPersonaPorCi(ci: string) {
  return prisma.persona.findUnique({ where: { ci } })
}

// Aplana persona.{nombre,apellido,ci,...} al nivel del perfil, para que
// el resto del código (y el frontend) siga leyendo `docente.nombre` en
// vez de `docente.persona.nombre`.
export function aplanarPersona<T extends { persona?: Record<string, any> | null }>(
  perfil: T
): Omit<T, 'persona'> & Record<string, any> {
  const { persona, ...resto } = perfil as any
  // ⚠️ FIX: persona va PRIMERO y resto (el perfil: docente/director/
  // secretaria/estudiante/tutor) va DESPUÉS. Antes era al revés, y como
  // Persona también tiene su propio "id", pisaba el id real del perfil
  // (docente.id, etc.) con personaId — causando 404 en cualquier PUT/POST
  // que usara ese id para operar sobre el perfil (asignar materia, editar,
  // vincular cuenta...) en cuanto personaId y perfil.id dejaban de coincidir.
  return { ...(persona ?? {}), ...resto }
}

// ─── Perfiles de rol ──────────────────────────────────────────────────────

export interface DatosPorRol {
  DIRECTOR?:   { gestionId?: number }
  SECRETARIA?: Record<string, never>
  DOCENTE?:    { especialidad?: string }
  ESTUDIANTE?: {
    rude?: string
    lugarNacimiento?: string
    idiomaMaterno?: string
    idiomaHablado?: string
    discapacidad?: boolean
    tipoDiscapacidad?: string
  }
  TUTOR?: { ocupacion?: string; gradoInstruccion?: string }
}

// Crea un perfil por cada rol en `roles`, todos apuntando a la MISMA
// Persona (una persona puede ser Director y Docente al mismo tiempo,
// pero solo tiene una fila en cada tabla de rol — @@unique(personaId)).
// `usuarioId` es opcional porque Docente/Estudiante/Tutor pueden existir
// sin cuenta de acceso; Director/Secretaria SIEMPRE requieren usuarioId
// (su campo no es nullable en el schema).
export async function crearPerfilesParaRoles(
  tx: any,
  roles: Rol[],
  personaId: number,
  usuarioId: number,
  datosPorRol: DatosPorRol = {}
): Promise<Partial<Record<Rol, any>>> {
  const perfiles: Partial<Record<Rol, any>> = {}

  for (const rol of roles) {
    switch (rol) {
      case 'DIRECTOR': {
        const director = await tx.director.create({ data: { personaId, usuarioId } })
        const gestionId = datosPorRol.DIRECTOR?.gestionId
        if (gestionId) {
          await tx.gestion.update({ where: { id: gestionId }, data: { directorId: director.id } })
        }
        perfiles.DIRECTOR = director
        break
      }
      case 'SECRETARIA':
        perfiles.SECRETARIA = await tx.secretaria.create({ data: { personaId, usuarioId } })
        break
      case 'DOCENTE':
        perfiles.DOCENTE = await tx.docente.create({
          data: { personaId, usuarioId, especialidad: datosPorRol.DOCENTE?.especialidad },
        })
        break
      case 'ESTUDIANTE':
        perfiles.ESTUDIANTE = await tx.estudiante.create({
          data: {
            personaId, usuarioId,
            rude:             datosPorRol.ESTUDIANTE?.rude,
            lugarNacimiento:  datosPorRol.ESTUDIANTE?.lugarNacimiento,
            idiomaMaterno:    datosPorRol.ESTUDIANTE?.idiomaMaterno,
            idiomaHablado:    datosPorRol.ESTUDIANTE?.idiomaHablado,
            discapacidad:     datosPorRol.ESTUDIANTE?.discapacidad ?? false,
            tipoDiscapacidad: datosPorRol.ESTUDIANTE?.tipoDiscapacidad,
          },
        })
        break
      case 'TUTOR':
        perfiles.TUTOR = await tx.tutor.create({
          data: {
            personaId, usuarioId,
            ocupacion:        datosPorRol.TUTOR?.ocupacion,
            gradoInstruccion: datosPorRol.TUTOR?.gradoInstruccion,
          },
        })
        break
    }
  }

  return perfiles
}

export const ROLES_VALIDOS: Rol[] = ['DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR']

// "María" y "maria " se consideran el mismo texto.
export const sinTildes = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// Una misma PERSONA puede tener varios perfiles (un docente que también es tutor de un
// alumno, un padre contratado como docente...). El modelo lo permite: Persona es compartida.
// Antes, registrar un tutor/docente con un CI ya existente respondía 409 siempre, aunque
// fuera la misma persona.
//
// Si el CI ya existe:
//   • misma persona (mismo nombre y apellido) sin ese perfil → se devuelve para AGREGARLE el
//     perfil; sus datos de contacto NO se modifican (se editan desde su ficha);
//   • otro nombre → 409: casi seguro es un error de digitación y no se mezclan personas;
//   • ya tiene ese perfil → 409.
// Si el CI es nuevo devuelve null (hay que crear la persona).
export async function personaExistenteParaPerfil(
  tx: any,
  datos: { ci: string; nombre: string; apellido: string },
  perfil: 'docente' | 'tutor',
): Promise<{ id: number } | null> {
  const existente = await tx.persona.findUnique({
    where:  { ci: datos.ci },
    select: { id: true, nombre: true, apellido: true, docente: { select: { id: true } }, tutor: { select: { id: true } } },
  })
  if (!existente) return null

  if (sinTildes(`${datos.nombre} ${datos.apellido}`) !== sinTildes(`${existente.nombre} ${existente.apellido}`)) {
    throw new ErrorDeUsuario(
      `El CI ${datos.ci} ya está registrado a nombre de ${existente.nombre} ${existente.apellido}. ` +
      'Si es otra persona, revisa el CI; si es la misma, escribe su nombre tal como está registrado.',
      409,
    )
  }
  if (existente[perfil]) throw new ErrorDeUsuario(`Ya existe un ${perfil} con el CI ${datos.ci}`, 409)
  return { id: existente.id }
}