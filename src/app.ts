import 'dotenv/config'
import './lib/config.js'   // valida JWT_SECRET al arrancar: si falta o es débil, el servidor no inicia
import express, { type Express } from 'express'
import cors from 'cors'

// Security
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import authRoutes         from './routes/auth.routes.js'
import usuarioRoutes      from './routes/usuario.routes.js'
import gestionRoutes      from './routes/gestion.routes.js'
import cursoRoutes        from './routes/curso.routes.js'
import materiaRoutes      from './routes/materia.routes.js'
import trimestreRoutes    from './routes/trimestre.routes.js'
import docenteRoutes      from './routes/docente.routes.js'
import estudianteRoutes   from './routes/estudiante.routes.js'
import inscripcionRoutes  from './routes/inscripcion.routes.js'
import tutorRoutes        from './routes/tutor.routes.js'
import asistenciaRoutes   from './routes/asistencia.routes.js'
import calificacionRoutes from './routes/calificacion.routes.js'
import evaluacionRoutes   from './routes/evaluacion.routes.js'
import actividadRoutes    from './routes/actividad.routes.js'
import pagoRoutes         from './routes/pago.routes.js'
import boletinRoutes      from './routes/boletin.routes.js'
import reporteRoutes      from './routes/reporte.routes.js'
import directorRoutes   from './routes/director.routes.js'
import secretariaRoutes from './routes/secretaria.routes.js'
import institucionRoutes from './routes/institucion.routes.js'
import horarioRoutes from './routes/horario.routes.js'
import { errorMiddleware } from './middlewares/error.middleware.js'

const app: Express = express()

// Detrás de un proxy (nginx, Render, Railway, Cloudflare...) Express ve la IP
// del proxy, no la del cliente: el rate limit contaría a TODOS como una sola
// IP. Se activa solo si defines TRUST_PROXY en el .env (1 = un proxy delante).
// No lo actives si no hay proxy: permitiría falsificar la IP con X-Forwarded-For.
const trustProxy = process.env.TRUST_PROXY
if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)

// Security
app.use(helmet())

app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ✅ Límite general por IP — defensa de segunda línea contra scraping/DoS
// básico. El bloqueo fino por CUENTA (el que importa de verdad para
// fuerza bruta de contraseña) vive en auth.controller.ts, no acá.
const limiteGeneral = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutos
  limit: 300,                  // 300 requests por IP en esa ventana
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api', limiteGeneral)

// ✅ Límite específico y más estricto en login — evita que alguien
// pruebe miles de combinaciones usuario/contraseña por fuerza bruta
// contra distintas cuentas antes de que el bloqueo por cuenta actúe.
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,                   // 15 intentos FALLIDOS de login por IP en 15 min
  // Solo cuentan los intentos fallidos: en un colegio muchos estudiantes
  // comparten la misma IP (wifi/NAT) y con los logins correctos contando,
  // el curso entero quedaba bloqueado a la 16.ª persona que entraba.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso desde esta red. Esperá unos minutos.' },
})

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

// Rutas
// Auth
// El límite va SOLO sobre el login. Antes cubría todo /api/auth (incluidos
// /me y /password) y además authRoutes estaba montado dos veces.
app.use('/api/auth/login', limiteLogin)
app.use('/api/auth',          authRoutes)
app.use('/api/usuarios',      usuarioRoutes)

// Estructura académica
app.use('/api/gestiones',     gestionRoutes)
app.use('/api/cursos',        cursoRoutes)
app.use('/api/materias',      materiaRoutes)
app.use('/api/trimestres',    trimestreRoutes)

// Personas
app.use('/api/docentes',      docenteRoutes)
app.use('/api/estudiantes',   estudianteRoutes)
app.use('/api/inscripciones', inscripcionRoutes)
app.use('/api/tutores',       tutorRoutes)
app.use('/api/directores',  directorRoutes)
app.use('/api/secretarias', secretariaRoutes)


// Académico
app.use('/api/asistencia',    asistenciaRoutes)
app.use('/api/calificaciones',calificacionRoutes)
// Dimensiones / actividades evaluativas / notas — ver evaluacion.routes.ts
app.use('/api',               evaluacionRoutes)
app.use('/api/actividades',   actividadRoutes)

// Pagos
app.use('/api/pagos',         pagoRoutes)

// Reportes
app.use('/api/boletin',       boletinRoutes)
app.use('/api',               reporteRoutes)

// Institución
app.use('/api/institucion', institucionRoutes)
app.use('/api/horarios', horarioRoutes)

// Middleware de error — siempre último, captura asyncHandler/multer
app.use(errorMiddleware)

export default app