// src/lib/ownership.helper.ts
//
// Único lugar que responde "¿este recurso es del usuario autenticado?".
//
// REGLA DE ORO de este archivo (la razón de varios bugs reales):
// en Prisma, un filtro con valor `undefined` se IGNORA. Por eso
//   findFirst({ where: { tutorId: tutor?.id, estudianteId } })
// cuando el usuario no tiene perfil de tutor se convierte en
//   findFirst({ where: { estudianteId } })
// y devuelve un vínculo de OTRO tutor => acceso concedido por error.
// Aquí SIEMPRE se comprueba que el perfil exista antes de consultar.

import type { Request } from 'express'
import { prisma } from './prisma.js'

// true si el usuario tiene un rol de "administración" que se salta
// cualquier restricción de pertenencia (Director/Secretaria).
export function esAdmin(req: Request): boolean {
  return req.user!.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))
}

// ─── Perfiles del usuario autenticado ────────────────────────────────────────
// Devuelven el perfil o null. Nunca se usa `perfil?.id` dentro de un where.

async function perfilDocente(req: Request) {
  if (!req.user!.roles.includes('DOCENTE')) return null
  return prisma.docente.findFirst({ where: { usuarioId: req.user!.id }, select: { id: true } })
}

async function perfilEstudiante(req: Request) {
  if (!req.user!.roles.includes('ESTUDIANTE')) return null
  return prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id }, select: { id: true } })
}

async function perfilTutor(req: Request) {
  if (!req.user!.roles.includes('TUTOR')) return null
  return prisma.tutor.findFirst({ where: { usuarioId: req.user!.id }, select: { id: true } })
}

// ID del estudiante propio (si el usuario es ESTUDIANTE y tiene perfil).
export async function miEstudianteId(req: Request): Promise<number | null> {
  return (await perfilEstudiante(req))?.id ?? null
}

// IDs de los estudiantes vinculados al usuario como TUTOR (vacío si no aplica).
export async function estudiantesDeMiTutoria(req: Request): Promise<number[]> {
  const tutor = await perfilTutor(req)
  if (!tutor) return []
  const vinculos = await prisma.tutorEstudiante.findMany({
    where: { tutorId: tutor.id },
    select: { estudianteId: true },
  })
  return vinculos.map(v => v.estudianteId)
}

// ─── Docente ─────────────────────────────────────────────────────────────────

// Docente: ¿esta asignación (DocenteMateriaCurso) es suya?
export async function esDocenteDeAsignacion(req: Request, docenteMateriaCursoId: number): Promise<boolean> {
  if (esAdmin(req)) return true
  const docente = await perfilDocente(req)
  if (!docente) return false
  const asignacion = await prisma.docenteMateriaCurso.findFirst({
    where: { id: docenteMateriaCursoId, docenteId: docente.id },
    select: { id: true },
  })
  return !!asignacion
}

// Docente: ¿tiene al menos una asignación en este curso+gestión?
// Se usa cuando el endpoint recibe un inscripcionId/cursoId en vez de
// un docenteMateriaCursoId directo.
export async function esDocenteDelCurso(req: Request, cursoId: number, gestionId: number): Promise<boolean> {
  if (esAdmin(req)) return true
  const docente = await perfilDocente(req)
  if (!docente) return false
  const asignacion = await prisma.docenteMateriaCurso.findFirst({
    where: { docenteId: docente.id, cursoId, gestionId },
    select: { id: true },
  })
  return !!asignacion
}

// Docente: ¿este estudiante está (o estuvo) inscrito en algún curso+gestión
// donde el docente tiene una asignación?
async function esDocenteDeEstudiante(req: Request, estudianteId: number): Promise<boolean> {
  const docente = await perfilDocente(req)
  if (!docente) return false

  const asignaciones = await prisma.docenteMateriaCurso.findMany({
    where: { docenteId: docente.id },
    select: { cursoId: true, gestionId: true },
    distinct: ['cursoId', 'gestionId'],
  })
  if (asignaciones.length === 0) return false

  const inscripcion = await prisma.inscripcion.findFirst({
    where: { estudianteId, OR: asignaciones },
    select: { id: true },
  })
  return !!inscripcion
}

// ─── Familia (estudiante / tutor) ────────────────────────────────────────────

// ¿El usuario ES este estudiante, o es tutor vinculado a él?
// Comprueba AMBOS caminos: una cuenta con roles ESTUDIANTE+TUTOR ya no queda
// evaluada solo por el primero (antes el `return` temprano ignoraba al tutor).
export async function esFamiliaDeEstudiante(req: Request, estudianteId: number): Promise<boolean> {
  if (esAdmin(req)) return true
  if (!Number.isInteger(estudianteId)) return false

  const propio = await miEstudianteId(req)
  if (propio !== null && propio === estudianteId) return true

  const tutorados = await estudiantesDeMiTutoria(req)
  return tutorados.includes(estudianteId)
}

// ─── Regla única para "ver datos de UN estudiante" ───────────────────────────
//
// Admin → sí. El propio estudiante → sí. Tutor vinculado → sí.
// Docente → solo si el estudiante está en un curso+gestión donde enseña.
// Cualquier otro caso (incluido un perfil inexistente) → no.
//
// Úsala en TODO endpoint que reciba un estudianteId y devuelva sus datos
// (notas, asistencia, boletín, ficha). Así la regla vive en un solo lugar.
export async function puedeVerEstudiante(req: Request, estudianteId: number): Promise<boolean> {
  if (!Number.isInteger(estudianteId)) return false
  if (await esFamiliaDeEstudiante(req, estudianteId)) return true
  return esDocenteDeEstudiante(req, estudianteId)
}