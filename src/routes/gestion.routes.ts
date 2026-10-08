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
  getPropuestaResultados,
  registrarResultados,
  copiarEstructuraGestion,
  getCursosPromocion,
  getPropuestaMatricula,
  matricularPromocion,
} from '../controllers/gestion.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

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
router.get('/:id/propuesta-resultados',    requireRol('DIRECTOR', 'SECRETARIA'), getPropuestaResultados)
router.post('/:id/resultados',             requireRol('DIRECTOR', 'SECRETARIA'), registrarResultados)
router.post('/:id/copiar-estructura',      requireRol('DIRECTOR'), copiarEstructuraGestion)
router.get('/:id/promocion/cursos',        requireRol('DIRECTOR', 'SECRETARIA'), getCursosPromocion)
router.get('/:id/promocion/matricula',     requireRol('DIRECTOR', 'SECRETARIA'), getPropuestaMatricula)
router.post('/:id/promocion/matricular',   requireRol('DIRECTOR', 'SECRETARIA'), matricularPromocion)

export default router