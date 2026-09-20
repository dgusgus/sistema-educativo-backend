// src/routes/evaluacion.routes.ts
//
// ARCHIVO NUEVO — no existía en el proyecto original. Cubre
// DimensionEvaluacion, ActividadEvaluativa y el registro de
// NotaActividad (ver evaluacion.controller.ts). Falta registrarlo en
// app.ts:
//   import evaluacionRoutes from './routes/evaluacion.routes.js'
//   app.use('/api', evaluacionRoutes)

import { Router } from 'express'
import {
  getNotasActividad,
  getDimensiones,
  createDimension,
  updateDimension,
  deleteDimension,
  getActividadesEvaluativas,
  createActividadEvaluativa,
  desactivarActividadEvaluativa,
  registrarNotasActividad,
} from '../controllers/evaluacion.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { requireRol }     from '../middlewares/rbac.middleware.js'

const router = Router()
router.use(authMiddleware)

// Dimensiones de evaluación (Ser/Saber/Hacer/Decidir) — las define
// Dirección por gestión
router.get('/dimensiones',     requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getDimensiones)
router.post('/dimensiones',    requireRol('DIRECTOR'), createDimension)
router.put('/dimensiones/:id', requireRol('DIRECTOR'), updateDimension)
router.delete('/dimensiones/:id', requireRol('DIRECTOR'), deleteDimension)

// Actividades evaluativas (lo que el docente califica)
router.get('/actividades-evaluativas',     requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getActividadesEvaluativas)
router.post('/actividades-evaluativas',    requireRol('DOCENTE', 'DIRECTOR'), createActividadEvaluativa)
router.delete('/actividades-evaluativas/:id', requireRol('DOCENTE', 'DIRECTOR'), desactivarActividadEvaluativa)

// Notas de una actividad — dispara el recálculo del promedio
router.post('/actividades-evaluativas/:id/notas', requireRol('DOCENTE', 'DIRECTOR'), registrarNotasActividad)
router.get('/actividades-evaluativas/:id/notas', requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getNotasActividad)

export default router