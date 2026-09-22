// src/lib/ownership.helper.ts
//
// Único lugar que responde "¿este recurso es del usuario autenticado?"
// Reemplaza el bloque copiado en asistencia/calificacion/evaluacion/
// horario.controller.ts. Un módulo nuevo que necesite la misma regla
// (docente solo ve sus asignaciones) llama a esto, no la reescribe.

import type { Request } from 'express'
import { prisma } from './prisma.js'

// true si el usuario tiene un rol de "administración" que se salta
// cualquier restricción de pertenencia (Director/Secretaria).
export function esAdmin(req: Request): boolean {
  return req.user!.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))
}

// Docente: ¿esta asignación (DocenteMateriaCurso) es suya?
export async function esDocenteDeAsignacion(req: Request, docenteMateriaCursoId: number): Promise<boolean> {
  if (esAdmin(req)) return true
  if (!req.user!.roles.includes('DOCENTE')) return false
  const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user!.id } })
  const asignacion = await prisma.docenteMateriaCurso.findFirst({
    where: { id: docenteMateriaCursoId, docenteId: docente?.id },
  })
  return !!asignacion
}

// Estudiante: ¿esta inscripción es suya? Tutor: ¿está vinculado a ese estudiante?
export async function esFamiliaDeEstudiante(req: Request, estudianteId: number): Promise<boolean> {
  if (esAdmin(req)) return true
  if (req.user!.roles.includes('ESTUDIANTE')) {
    const estudiante = await prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id } })
    return estudiante?.id === estudianteId
  }
  if (req.user!.roles.includes('TUTOR')) {
    const tutor = await prisma.tutor.findFirst({ where: { usuarioId: req.user!.id } })
    const vinculo = await prisma.tutorEstudiante.findFirst({ where: { tutorId: tutor?.id, estudianteId } })
    return !!vinculo
  }
  return false
}



/* 
// ❌ antes — 5 líneas repetidas
if (req.user?.roles.includes('DOCENTE') && !req.user.roles.some(r => ['DIRECTOR', 'SECRETARIA'].includes(r))) {
  const docente = await prisma.docente.findFirst({ where: { usuarioId: req.user.id } })
  const asignacion = await prisma.docenteMateriaCurso.findFirst({ where: { id: dmcId, docenteId: docente?.id } })
  if (!asignacion) { res.status(403).json({ error: 'Sin acceso a esta materia/curso' }); return }
}

// ✅ ahora — 1 línea, mismo comportamiento
if (!await esDocenteDeAsignacion(req, dmcId)) { res.status(403).json({ error: 'Sin acceso a esta materia/curso' }); return } */