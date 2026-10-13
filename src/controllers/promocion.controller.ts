// src/controllers/promocion.controller.ts
//
// Capa HTTP del flujo de Promoción: lee lo ya validado por la ruta, llama al
// servicio y responde. Sin try/catch (Express 5 envía los errores al middleware),
// sin reglas de negocio y sin importar Prisma salvo para ABRIR la transacción.
//
// Los `as` de abajo son seguros: la ruta ejecutó `validar(...)` antes y dejó
// req.query / req.body ya convertidos con exactamente estos tipos.
import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { calcularResultadosGestion, registrarResultadosLote } from '../services/resultado-final.service.js'
import { copiarEstructura } from '../services/copiar-estructura.service.js'
import { resumenCursosPromocion, propuestaMatriculaCurso, matricularCurso } from '../services/promocion.service.js'
import type {
  CopiaInput, ResultadosQuery, ResultadosBody, CursosPromocionQuery, PropuestaMatriculaQuery, MatricularBody,
} from '../schemas/promocion.schema.js'

const TX = { timeout: 30_000 }
const gestionId = (req: Request) => Number(req.params.id)   // paramEntero ya garantiza un entero válido

// GET /api/gestiones/:id/propuesta-resultados — Paso 1 (solo calcula, no escribe)
export async function getPropuestaResultados(req: Request, res: Response): Promise<void> {
  const { cursoId } = req.query as ResultadosQuery
  res.json(await calcularResultadosGestion(gestionId(req), { cursoId }))
}

// POST /api/gestiones/:id/resultados — Paso 1 (escribe el resultado calculado por el servidor)
export async function registrarResultados(req: Request, res: Response): Promise<void> {
  const { inscripcionIds, cursoId } = req.body as ResultadosBody
  res.json(await registrarResultadosLote(gestionId(req), inscripcionIds, cursoId))
}

// POST /api/gestiones/:id/copiar-estructura
export async function copiarEstructuraGestion(req: Request, res: Response): Promise<void> {
  const { origenId, ...opciones } = req.body as CopiaInput
  res.json(await prisma.$transaction(tx => copiarEstructura(origenId, gestionId(req), opciones, tx), TX))
}

// GET /api/gestiones/:id/promocion/cursos?destinoId=N — tablero por curso
export async function getCursosPromocion(req: Request, res: Response): Promise<void> {
  const { destinoId } = req.query as CursosPromocionQuery
  res.json(await resumenCursosPromocion(gestionId(req), destinoId))
}

// GET /api/gestiones/:id/promocion/matricula?cursoId=N&destinoId=M — Paso 2 (propuesta)
export async function getPropuestaMatricula(req: Request, res: Response): Promise<void> {
  const { cursoId, destinoId } = req.query as unknown as PropuestaMatriculaQuery
  res.json(await propuestaMatriculaCurso(gestionId(req), cursoId, destinoId))
}

// POST /api/gestiones/:id/promocion/matricular — Paso 2 (matricula en lote)
export async function matricularPromocion(req: Request, res: Response): Promise<void> {
  res.json(await prisma.$transaction(tx => matricularCurso(gestionId(req), req.body as MatricularBody, tx), TX))
}
