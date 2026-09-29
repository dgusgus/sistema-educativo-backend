import { Router } from 'express'
import {
  generarBoletin,
  generarBoletinesCurso,
  obtenerBoletinGeneral,
  obtenerMejoresEstudiantes,
  generarLibreta,
  obtenerDetalleEstudiante,
  obtenerDetallePorEstudiante,
} from '../controllers/boletin.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// ⚠️ RUTAS ESPECÍFICAS SIEMPRE ANTES que '/:estudianteId/:trimestreId' —
// '/general', '/mejores' y '/detalle' tienen la MISMA forma (boletin + 2
// segmentos) que esa genérica; si se registran después, la genérica se
// las come (ver el bug real que tenías con '/general').

// Boletín General del curso en pantalla (JSON)
router.get(
  '/general/:cursoId',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  obtenerBoletinGeneral
)

// Mejores Estudiantes del curso (JSON)
router.get(
  '/mejores/:cursoId',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  obtenerMejoresEstudiantes
)

// Detalle de un estudiante: dimensiones + actividades por trimestre y
// materia (JSON) — para la tarjeta de detalle. RBAC de pertenencia
// (docente asignado / familia del estudiante) vive dentro del controller.
router.get(
  '/detalle/:inscripcionId',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'),
  obtenerDetalleEstudiante
)

// Mismo detalle, resuelto por estudianteId + gestionId en vez de
// inscripcionId — para el preview en BoletinesView (tab Individual), donde
// el buscador solo devuelve el estudiante, no la inscripción.
router.get(
  '/detalle-por-estudiante/:estudianteId/:gestionId',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR'),
  obtenerDetallePorEstudiante
)

// Libreta anual (PDF)
router.get(
  '/libreta/:estudianteId/:gestionId',
  requireRol('DIRECTOR', 'SECRETARIA', 'ESTUDIANTE', 'TUTOR'),
  generarLibreta
)

// Boletines masivos del curso (PDF, 1 trimestre)
router.get(
  '/curso/:cursoId/:trimestreId',
  requireRol('DIRECTOR', 'SECRETARIA'),
  generarBoletinesCurso
)

// Boletín individual (PDF, 1 trimestre) — SIEMPRE AL FINAL
router.get(
  '/:estudianteId/:trimestreId',
  requireRol('DIRECTOR', 'SECRETARIA', 'ESTUDIANTE', 'TUTOR'),
  generarBoletin
)

export default router