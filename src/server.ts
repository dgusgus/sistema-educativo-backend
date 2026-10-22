import app from './app.js'
import { config } from './lib/config.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/prisma.js'
import { refrescarInstitucion } from './lib/institucion.helper.js'

const server = app.listen(config.port, () => {
  logger.info({ puerto: config.port, ambiente: config.nodeEnv }, 'Servidor iniciado')
})

// Datos del colegio para los encabezados de PDF (si la BD no responde aún, se reintenta solo).
refrescarInstitucion().catch(err => logger.warn({ err }, 'No se pudieron precargar los datos de la institución'))

// ─── Apagado ordenado ────────────────────────────────────────────────────────
// ¿Para qué? Cuando el hosting reinicia o despliega, envía SIGTERM. Sin esto el
// proceso muere en seco: las peticiones en curso (un PDF a medio generar, un
// registro de notas) se cortan y las conexiones a PostgreSQL quedan colgadas.
// Con esto: se deja de aceptar peticiones nuevas, se terminan las que están en
// curso y recién entonces se cierra la conexión a la base de datos.
let cerrando = false
async function apagar(senal: string): Promise<void> {
  if (cerrando) return
  cerrando = true
  logger.info({ senal }, 'Apagando servidor...')

  // Si algo queda colgado, se fuerza la salida a los 10 s.
  setTimeout(() => { logger.error('Apagado forzado por tiempo agotado'); process.exit(1) }, 10_000).unref()

  server.close(async () => {
    await prisma.$disconnect()
    logger.info('Servidor detenido correctamente')
    process.exit(0)
  })
}
process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT',  () => void apagar('SIGINT'))

// Un rechazo de promesa que nadie atrapó es un bug: se registra con detalle
// (en Node ≥ 15 además tumbaría el proceso sin dejar rastro útil).
process.on('unhandledRejection', err => logger.error({ err }, 'Promesa rechazada sin manejar'))
process.on('uncaughtException', err => { logger.fatal({ err }, 'Excepción no capturada'); process.exit(1) })
