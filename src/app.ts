import 'dotenv/config'
import express, { type Express } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { pinoHttp } from 'pino-http'
import { randomUUID } from 'node:crypto'

import { config } from './lib/config.js'   // valida TODAS las variables de entorno al arrancar
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'

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
import directorRoutes     from './routes/director.routes.js'
import secretariaRoutes   from './routes/secretaria.routes.js'
import institucionRoutes  from './routes/institucion.routes.js'
import horarioRoutes      from './routes/horario.routes.js'
import cuadernoRoutes     from './routes/cuaderno.routes.js'
import { authMiddleware } from './middlewares/auth.middleware.js'
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware.js'

const app: Express = express()

// Detrás de un proxy (nginx, Render, Railway, Cloudflare...) Express ve la IP del
// proxy, no la del cliente: el rate limit contaría a TODOS como una sola IP. Se activa
// solo si defines TRUST_PROXY. No lo actives si no hay proxy: permitiría falsificar
// la IP con X-Forwarded-For.
if (config.trustProxy !== null) app.set('trust proxy', config.trustProxy)

// ─── Seguridad y utilidades globales ─────────────────────────────────────────
app.use(helmet())

// CORS con lista de orígenes (FRONTEND_URL="https://a.com,https://b.com").
// Con `credentials: true` el origen debe ser exacto, nunca "*".
app.use(cors({
  origin: config.corsOrigins.length === 1 ? config.corsOrigins[0] : config.corsOrigins,
  credentials: true,
}))

// Log de cada request (método, ruta, status, duración) con un id único que también
// aparece en el log de errores y en la respuesta 500 ("referencia"): si un usuario
// reporta un fallo, buscas ese id y ves exactamente qué pasó.
// /api/health se omite para no llenar el log con los chequeos del hosting.
app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) ?? randomUUID()
    res.setHeader('X-Request-Id', id)
    return id
  },
  autoLogging: { ignore: req => req.url === '/api/health' || req.url === '/api/ready' },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  serializers: {
    req: req => ({ id: req.id, method: req.method, url: req.url }),   // sin headers: nada de tokens en el log
    res: res => ({ statusCode: res.statusCode }),
  },
}))

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// ─── Límites de peticiones ───────────────────────────────────────────────────
// Segunda línea de defensa contra scraping/DoS básico. El bloqueo fino por CUENTA
// (el que importa contra fuerza bruta de contraseñas) vive en auth.controller.ts.
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
}))

// Más estricto en login. Solo cuentan los intentos FALLIDOS: en un colegio muchos
// estudiantes comparten la misma IP (wifi/NAT) y, si contaran los correctos, el
// curso entero quedaría bloqueado a la persona número 16.
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso desde esta red. Espera unos minutos.' },
}))

// ─── Rutas PÚBLICAS (antes de la autenticación) ──────────────────────────────
// /health: "¿el proceso está vivo?" — lo usa Docker/Render. No toca la BD.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})
// /ready: "¿puede atender tráfico?" — comprueba la conexión a PostgreSQL.
app.get('/api/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ready' })
  } catch (err) {
    logger.error({ err }, 'La base de datos no responde')
    res.status(503).json({ status: 'unavailable' })
  }
})
// auth.routes.ts mezcla rutas públicas (login) y protegidas (me, password): cada
// ruta protegida ya declara authMiddleware dentro del propio router.
app.use('/api/auth', authRoutes)

// ─── Autenticación: UNA sola vez para todo lo demás ──────────────────────────
// Los routers ya NO hacen router.use(authMiddleware). Antes, evaluacionRoutes y
// reporteRoutes están montados en '/api' y ejecutaban authMiddleware (con su
// consulta a la BD) para CUALQUIER ruta que pasara por ahí, aunque no fuera suya.
app.use('/api', authMiddleware)

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
app.use('/api/directores',    directorRoutes)
app.use('/api/secretarias',   secretariaRoutes)

// Académico
app.use('/api/asistencia',     asistenciaRoutes)
app.use('/api/calificaciones', calificacionRoutes)
app.use('/api/actividades',    actividadRoutes)
app.use('/api/pagos',          pagoRoutes)
app.use('/api/boletin',        boletinRoutes)
app.use('/api/institucion',    institucionRoutes)
app.use('/api/horarios',       horarioRoutes)
app.use('/api/cuaderno',       cuadernoRoutes)

// Routers que definen sus propias rutas completas bajo /api
// (/dimensiones, /actividades-evaluativas, /dashboard, /reportes/...).
// Siguen al final para que no intercepten las rutas de arriba.
app.use('/api', evaluacionRoutes)
app.use('/api', reporteRoutes)

// ─── Errores ─────────────────────────────────────────────────────────────────
app.use(notFoundMiddleware)   // 404 en JSON
app.use(errorMiddleware)      // SIEMPRE el último

export default app
