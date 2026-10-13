import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { firmarToken } from '../lib/token.helper.js'
import { NoEncontrado, ErrorDeUsuario } from '../lib/errores.js'
import { logger } from '../lib/logger.js'

const MAX_INTENTOS_FALLIDOS = 5
const MINUTOS_BLOQUEO       = 15
const COSTO_BCRYPT          = 12

// Hash "señuelo" para cuando el usuario NO existe. Sin esto, un usuario inexistente
// responde en ~1 ms (no se llama a bcrypt) y uno existente en ~250 ms: midiendo el
// tiempo, un atacante descubre qué usernames existen aunque el mensaje sea idéntico.
// Con el señuelo ambos caminos gastan el mismo tiempo.
const HASH_SENUELO = bcrypt.hashSync('contraseña-que-nadie-usa', COSTO_BCRYPT)

const personaSelect = { select: { id: true, nombre: true, apellido: true } } as const
const perfilesInclude = {
  director:   { include: { persona: personaSelect } },
  secretaria: { include: { persona: personaSelect } },
  docente:    { include: { persona: personaSelect } },
  estudiante: { include: { persona: personaSelect } },
  tutor:      { include: { persona: personaSelect } },
} as const

interface PerfilConPersona { persona: { nombre: string; apellido: string } }

// El nombre para mostrar sale del primer perfil que exista, en este orden de
// prioridad. Con Persona compartida da igual cuál se use: el nombre es el mismo.
// (Antes los 5 parámetros estaban tipados `any`.)
function primerPerfil<
  A extends PerfilConPersona, B extends PerfilConPersona, C extends PerfilConPersona,
  D extends PerfilConPersona, E extends PerfilConPersona,
>(usuario: {
  director: A | null; secretaria: B | null; docente: C | null; estudiante: D | null; tutor: E | null
}): A | B | C | D | E | null {
  return usuario.director ?? usuario.secretaria ?? usuario.docente ?? usuario.estudiante ?? usuario.tutor ?? null
}

const MENSAJE_CREDENCIALES = 'Credenciales incorrectas'

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Body ya validado por loginSchema (ver auth.routes.ts).
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username: string; password: string }

  const usuario = await prisma.usuario.findUnique({ where: { username }, include: perfilesInclude })

  // Usuario inexistente: se gasta el mismo tiempo que con uno real y se responde
  // con el MISMO mensaje y forma que una contraseña incorrecta.
  if (!usuario) {
    await bcrypt.compare(password, HASH_SENUELO)
    res.status(401).json({ error: MENSAJE_CREDENCIALES })
    return
  }

  // Cuenta bloqueada: se corta ANTES de bcrypt (no se gasta CPU en algo que no pasará).
  if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) {
    const minutosRestantes = Math.ceil((usuario.bloqueadoHasta.getTime() - Date.now()) / 60_000)
    res.status(423).json({
      error: `Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en ${minutosRestantes} minuto(s).`,
    })
    return
  }

  const passwordValida = await bcrypt.compare(password, usuario.passwordHash)

  // Misma respuesta para "contraseña mala" y "cuenta desactivada" mientras no se
  // demuestre conocer la contraseña: así no se revela el estado de la cuenta.
  if (!passwordValida) {
    // Incremento ATÓMICO en la base de datos. Antes se leía el contador, se sumaba 1 en
    // Node y se escribía el resultado: 5 intentos simultáneos leían todos "0" y escribían
    // "1", así que el límite de 5 podía eludirse enviando las pruebas en paralelo.
    const { intentosFallidos } = await prisma.usuario.update({
      where:  { id: usuario.id },
      data:   { intentosFallidos: { increment: 1 } },
      select: { intentosFallidos: true },
    })

    if (intentosFallidos >= MAX_INTENTOS_FALLIDOS) {
      await prisma.usuario.update({
        where: { id: usuario.id },
        data:  { intentosFallidos: 0, bloqueadoHasta: new Date(Date.now() + MINUTOS_BLOQUEO * 60_000) },
      })
      logger.warn({ usuarioId: usuario.id, username, ip: req.ip }, 'Cuenta bloqueada por intentos fallidos')
      res.status(423).json({ error: `Demasiados intentos fallidos. Cuenta bloqueada por ${MINUTOS_BLOQUEO} minutos.` })
      return
    }

    // ⚠️ Ya no se devuelve `intentosRestantes`: ese campo solo existía para usuarios
    // REALES, así que permitía distinguir un username válido de uno inventado.
    res.status(401).json({ error: MENSAJE_CREDENCIALES })
    return
  }

  if (!usuario.activo) {
    res.status(401).json({ error: 'Cuenta desactivada. Contacta al administrador.' })
    return
  }

  await prisma.usuario.update({
    where: { id: usuario.id },
    data:  { intentosFallidos: 0, bloqueadoHasta: null, ultimoAcceso: new Date() },
  })

  const perfil = primerPerfil(usuario)
  const nombre = perfil ? `${perfil.persona.nombre} ${perfil.persona.apellido}` : usuario.username

  const token = firmarToken({
    id: usuario.id, roles: usuario.roles, username: usuario.username, nombre, passwordHash: usuario.passwordHash,
  })

  res.status(200).json({
    token,
    usuario: { id: usuario.id, username: usuario.username, roles: usuario.roles, nombre },
  })
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Datos del usuario autenticado. Sin try/catch: en Express 5 un error async llega
// solo al errorMiddleware (que lo registra y responde 500).
export const me = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.user!.id },
    select: { id: true, username: true, roles: true, activo: true, ...perfilesInclude },
  })
  if (!usuario) throw new NoEncontrado('Usuario')

  // "perfiles": todos los perfiles vinculados (uno por rol), aplanados
  // para que se lea perfil.nombre en vez de perfil.persona.nombre.
  const perfiles = {
    director:   usuario.director   ? aplanarPersona(usuario.director)   : null,
    secretaria: usuario.secretaria ? aplanarPersona(usuario.secretaria) : null,
    docente:    usuario.docente    ? aplanarPersona(usuario.docente)    : null,
    estudiante: usuario.estudiante ? aplanarPersona(usuario.estudiante) : null,
    tutor:      usuario.tutor      ? aplanarPersona(usuario.tutor)      : null,
  }
  const perfil = primerPerfil(usuario)

  res.status(200).json({
    id:       usuario.id,
    username: usuario.username,
    roles:    usuario.roles,
    activo:   usuario.activo,
    perfil:   perfil ? aplanarPersona(perfil) : null,  // compat: el "principal"
    perfiles,                                           // todos los que tenga
  })
})

// ─── PUT /api/auth/password ───────────────────────────────────────────────────
// Body validado por cambiarPasswordSchema (obligatorios + mínimo 8 caracteres).
export const cambiarPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { passwordActual, passwordNueva } = req.body as { passwordActual: string; passwordNueva: string }

  const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.id } })
  if (!usuario) throw new NoEncontrado('Usuario')

  if (!(await bcrypt.compare(passwordActual, usuario.passwordHash))) {
    throw new ErrorDeUsuario('La contraseña actual es incorrecta')
  }
  if (passwordActual === passwordNueva) {
    throw new ErrorDeUsuario('La nueva contraseña debe ser distinta de la actual')
  }

  const nuevoHash = await bcrypt.hash(passwordNueva, COSTO_BCRYPT)
  await prisma.usuario.update({ where: { id: usuario.id }, data: { passwordHash: nuevoHash } })

  // Cambiar la contraseña invalida los tokens anteriores (incluido el de esta
  // petición). Se devuelve uno nuevo para que el usuario no tenga que volver a entrar.
  const token = firmarToken({
    id: usuario.id, roles: usuario.roles, username: usuario.username,
    nombre: req.user!.nombre, passwordHash: nuevoHash,
  })

  res.status(200).json({ message: 'Contraseña actualizada correctamente', token })
})
