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
import { requireRol }     from '../middlewares/rbac.middleware.js'
import { validar, paramEntero } from '../middlewares/validate.middleware.js'
import { registrarNotasActividadSchema } from '../schemas/evaluacion.schema.js'

const router = Router()

// Un :id que no sea entero positivo responde 400 (antes: NaN → error 500 de Prisma)
router.param('id', paramEntero)

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
router.post(
  '/actividades-evaluativas/:id/notas',
  requireRol('DOCENTE', 'DIRECTOR'),
  validar({ body: registrarNotasActividadSchema }),
  registrarNotasActividad
)
router.get('/actividades-evaluativas/:id/notas', requireRol('DIRECTOR', 'SECRETARIA', 'DOCENTE'), getNotasActividad)

export default router