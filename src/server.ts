import app from './app.js'

const PORT = Number(process.env.PORT) || 4000

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`)
  console.log(`📋 Ambiente: ${process.env.NODE_ENV ?? 'development'}`)
})