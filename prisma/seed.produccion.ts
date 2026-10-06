// prisma/seed.produccion.ts
//
// ARRANQUE de un servidor REAL (primer despliegue). Crea lo mínimo para poder entrar:
//   • la institución, los campos de saber y el catálogo de materias
//   • la cuenta del DIRECTOR (con su persona y perfil)
// NO crea estudiantes, notas, pagos ni ninguna cuenta de prueba. La gestión, los
// cursos, los docentes, etc. los registra el director desde la propia aplicación.
//
// Uso:
//   SEED_ADMIN_USERNAME=director SEED_ADMIN_PASSWORD='una-clave-larga-y-unica' \
//   SEED_ADMIN_CI=1234567 SEED_ADMIN_NOMBRE=Roberto SEED_ADMIN_APELLIDO='Vargas Mamani' \
//   pnpm db:seed:prod
//
// La contraseña llega por variable de entorno y NUNCA se imprime ni se guarda en texto.
// Es seguro repetirlo: si el usuario ya existe NO se toca su contraseña.

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { sembrarCatalogo } from './seed.catalogo.js'

const BCRYPT_COSTO = 12   // el mismo orden de costo que conviene en producción (el demo usa 4 solo por velocidad)

// Contraseñas que jamás deben usarse (incluye las de la semilla de demo)
const PROHIBIDAS = new Set(['admin1234', 'sec1234', 'doc1234', 'est1234', 'tut1234', 'password', 'contraseña', '12345678', 'changeme'])

function leer(nombre: string, obligatoria = true): string {
  const v = (process.env[nombre] ?? '').trim()
  if (!v && obligatoria) throw new Error(`Falta la variable de entorno ${nombre}`)
  return v
}

function validarEntradas() {
  const username = leer('SEED_ADMIN_USERNAME')
  const password = process.env.SEED_ADMIN_PASSWORD ?? ''
  const ci       = leer('SEED_ADMIN_CI')
  const nombre   = leer('SEED_ADMIN_NOMBRE')
  const apellido = leer('SEED_ADMIN_APELLIDO')
  const email    = leer('SEED_ADMIN_EMAIL', false)
  const telefono = leer('SEED_ADMIN_TELEFONO', false)

  // Mismas reglas que valida la API al crear/editar (así el usuario también se puede editar luego)
  if (!/^\S{3,50}$/.test(username))                   throw new Error('SEED_ADMIN_USERNAME: 3 a 50 caracteres, sin espacios')
  if (!/^[0-9A-Za-z][0-9A-Za-z\-. ]{2,19}$/.test(ci)) throw new Error('SEED_ADMIN_CI: 3 a 20 caracteres (letras, números, guion, punto, espacio)')
  if (nombre.length > 100 || apellido.length > 100)   throw new Error('SEED_ADMIN_NOMBRE / SEED_ADMIN_APELLIDO: máximo 100 caracteres')
  if (PROHIBIDAS.has(password.toLowerCase()))         throw new Error('SEED_ADMIN_PASSWORD: es una contraseña conocida; elige otra')
  if (password.length < 12 || password.length > 72)   throw new Error('SEED_ADMIN_PASSWORD: entre 12 y 72 caracteres')
  if (password.toLowerCase().includes(username.toLowerCase())) throw new Error('SEED_ADMIN_PASSWORD: no debe contener el nombre de usuario')
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('SEED_ADMIN_EMAIL: correo inválido')
  return { username, password, ci, nombre, apellido, email: email || undefined, telefono: telefono || undefined }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL')
  const d = validarEntradas()

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  try {
    const { materias } = await sembrarCatalogo(prisma)
    console.log(`✓ Institución, campos de saber y ${Object.keys(materias).length} materias`)

    const existente = await prisma.usuario.findUnique({ where: { username: d.username }, select: { id: true } })
    if (existente) {
      console.log(`→ El usuario "${d.username}" ya existía: NO se modificó su contraseña ni sus datos`)
    } else {
      const choque = await prisma.persona.findUnique({ where: { ci: d.ci }, select: { id: true } })
      if (choque) throw new Error(`Ya existe una persona con CI ${d.ci}; usa otro SEED_ADMIN_CI`)

      const passwordHash = await bcrypt.hash(d.password, BCRYPT_COSTO)
      await prisma.$transaction(async tx => {
        const u = await tx.usuario.create({ data: { username: d.username, passwordHash, roles: ['DIRECTOR'], activo: true } })
        const p = await tx.persona.create({ data: { ci: d.ci, nombre: d.nombre, apellido: d.apellido, email: d.email, telefono: d.telefono } })
        await tx.director.create({ data: { personaId: p.id, usuarioId: u.id, activo: true } })
      })
      console.log(`✓ Director creado: usuario "${d.username}"`)
    }

    console.log('\n✅ Listo. Inicia sesión con ese usuario y su contraseña (no se muestra aquí).')
    console.log('   Siguiente paso, desde la aplicación: crear la gestión, los cursos y registrar al personal.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => {
  console.error('❌ Seed de producción falló:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})