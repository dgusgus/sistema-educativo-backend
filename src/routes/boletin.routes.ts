import { Router } from 'express'
import {
  generarBoletin,
  generarBoletinesCurso,
  obtenerBoletinGeneral,
  obtenerMejoresEstudiantes,
  generarLibreta,
} from '../controllers/boletin.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// ⚠️ RUTAS ESPECÍFICAS SIEMPRE ANTES que '/:estudianteId/:trimestreId' —
// mismo motivo que /export y /plantilla van antes de /:id en
// estudiante.routes.ts, docente.routes.ts, tutor.routes.ts. '/general',
// '/mejores' y '/curso' tienen la MISMA forma (boletin + 2 segmentos) que
// la genérica de abajo, así que si esta línea se mueve después de esa,
// vuelve a romperse exactamente como estaba.

// Boletín General del curso en pantalla (JSON) — admin o docente
// asignado (esDocenteDelCurso ya filtra fino adentro del controller)
router.get(
  '/general/:cursoId',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  obtenerBoletinGeneral
)

// Mejores Estudiantes del curso (JSON) — mismo criterio de acceso
router.get(
  '/mejores/:cursoId',
  requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'),
  obtenerMejoresEstudiantes
)

// Libreta anual (PDF) — mismo criterio de pertenencia que el boletín
// individual: Director/Secretaria sin filtro, Estudiante/Tutor solo lo
// suyo (RBAC de pertenencia vive dentro del controller)
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

// Boletín individual (PDF, 1 trimestre) — SIEMPRE AL FINAL: es la
// genérica de 2 parámetros que se come cualquier ruta más específica
// registrada después de ella.
router.get(
  '/:estudianteId/:trimestreId',
  requireRol('DIRECTOR', 'SECRETARIA', 'ESTUDIANTE', 'TUTOR'),
  generarBoletin
)

export default router