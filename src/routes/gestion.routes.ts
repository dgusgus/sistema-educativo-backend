import { Router } from 'express'
import {
  getGestiones,
  getGestionActiva,
  getGestionById,
  createGestion,
  updateGestion,
  asignarDirector,
  activarGestion,
  cerrarGestion,
  getPropuestaInscripciones,
} from '../controllers/gestion.controller.js'
import {
  getPropuestaResultados,
  registrarResultados,
  copiarEstructuraGestion,
  getCursosPromocion,
  getPropuestaMatricula,
  matricularPromocion,
} from '../controllers/promocion.controller.js'
import {
  copiaSchema, resultadosQuery, resultadosBody, cursosPromocionQuery, propuestaMatriculaQuery, matricularBody,
} from '../schemas/promocion.schema.js'
import { limitePorUsuario } from '../middlewares/limite.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { validar, paramEntero } from '../middlewares/validate.middleware.js'
const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)

// IMPORTANTE: rutas específicas ANTES de /:id
router.get('/activa', requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'), getGestionActiva)
router.get('/',        requireRol('DIRECTOR', 'SECRETARIA'), getGestiones)
router.get('/:id',     requireRol('DIRECTOR', 'SECRETARIA'), getGestionById)
router.post('/',       requireRol('DIRECTOR'), createGestion)
router.put('/:id',     requireRol('DIRECTOR'), updateGestion)

router.put('/:id/director', requireRol('DIRECTOR'), asignarDirector)
router.put('/:id/activar',  requireRol('DIRECTOR'), activarGestion)
router.post('/:id/cerrar',  requireRol('DIRECTOR'), cerrarGestion)
router.get('/:id/propuesta-inscripciones', requireRol('DIRECTOR', 'SECRETARIA'), getPropuestaInscripciones)

// ─── Promoción ───────────────────────────────────────────────────────────────
// Orden en cada ruta: permiso (403) → validación (400) → [límite por usuario] → controller.
// Los POST que escriben en lote llevan límite por usuario para frenar clics repetidos o
// scripts; copiar estructura es el más pesado, por eso tiene el cupo más bajo.
const limiteLote   = limitePorUsuario({ max: 60, ventanaMin: 10 })
const limiteCopia  = limitePorUsuario({ max: 10, ventanaMin: 10 })

router.get('/:id/propuesta-resultados', requireRol('DIRECTOR', 'SECRETARIA'),
  validar({ query: resultadosQuery }), getPropuestaResultados)
router.post('/:id/resultados',          requireRol('DIRECTOR', 'SECRETARIA'),
  validar({ body: resultadosBody }), limiteLote, registrarResultados)
router.post('/:id/copiar-estructura',   requireRol('DIRECTOR'),
  validar({ body: copiaSchema }), limiteCopia, copiarEstructuraGestion)
router.get('/:id/promocion/cursos',     requireRol('DIRECTOR', 'SECRETARIA'),
  validar({ query: cursosPromocionQuery }), getCursosPromocion)
router.get('/:id/promocion/matricula',  requireRol('DIRECTOR', 'SECRETARIA'),
  validar({ query: propuestaMatriculaQuery }), getPropuestaMatricula)
router.post('/:id/promocion/matricular', requireRol('DIRECTOR', 'SECRETARIA'),
  validar({ body: matricularBody }), limiteLote, matricularPromocion)

export default router