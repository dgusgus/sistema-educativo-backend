import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { Rol } from '../../prisma/generated/prisma/enums.js'
import {
  crearPersona,
  buscarPersonaPorCi,
  crearPerfilesParaRoles,
  aplanarPersona,
  validarPersona,
  ROLES_VALIDOS,
  type DatosPorRol,
  type PersonaInput,
} from '../lib/persona.helper.js'

// Select reutilizable: los 5 perfiles posibles con su Persona
const perfilesSelect = {
  director:   { select: { id: true, activo: true, persona: { select: { id: true, nombre: true, apellido: true, ci: true } } } },
  secretaria: { select: { id: true, activo: true, persona: { select: { id: true, nombre: true, apellido: true, ci: true } } } },
  docente:    { select: { id: true, activo: true, especialidad: true, persona: { select: { id: true, nombre: true, apellido: true, ci: true } } } },
  estudiante: { select: { id: true, activo: true, persona: { select: { id: true, nombre: true, apellido: true, ci: true } } } },
  tutor:      { select: { id: true, activo: true, persona: { select: { id: true, nombre: true, apellido: true, ci: true } } } },
} as const

// Aplana y arma { perfiles: {...}, perfil: <el primero que exista> }
// perfil (singular) queda por compatibilidad con el frontend viejo,
// que asumía un solo rol por usuario.
function armarPerfiles(u: {
  director: any; secretaria: any; docente: any; estudiante: any; tutor: any
}) {
  const perfiles = {
    director:   u.director   ? aplanarPersona(u.director)   : null,
    secretaria: u.secretaria ? aplanarPersona(u.secretaria) : null,
    docente:    u.docente    ? aplanarPersona(u.docente)    : null,
    estudiante: u.estudiante ? aplanarPersona(u.estudiante) : null,
    tutor:      u.tutor      ? aplanarPersona(u.tutor)      : null,
  }
  const perfil = perfiles.director ?? perfiles.secretaria ?? perfiles.docente
    ?? perfiles.estudiante ?? perfiles.tutor ?? null
  return { perfil, perfiles }
}

// ─── GET /api/usuarios ────────────────────────────────────────────────────────
export const getUsuarios = async (req: Request, res: Response): Promise<void> => {
  const { rol, activo, search } = req.query as {
    rol?:    string
    activo?: string
    search?: string
  }

  try {
    const usuarios = await prisma.usuario.findMany({
      where: {
        ...(rol    && { roles: { has: rol as Rol } }),   // antes: { rol: rol as Rol }
        ...(activo !== undefined && { activo: activo === 'true' }),
        ...(search && { username: { contains: search, mode: 'insensitive' } }),
      },
      select: {
        id:            true,
        username:      true,
        roles:         true,
        activo:        true,
        creadoEn:      true,
        actualizadoEn: true,
        ...perfilesSelect,
      },
      orderBy: [{ username: 'asc' }],
    })

    const resultado = usuarios.map(u => ({
      ...u,
      ...armarPerfiles(u),
    }))

    res.status(200).json(resultado)
  } catch (error) {
    console.error('[usuario.getUsuarios]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/usuarios/:id ────────────────────────────────────────────────────
export const getUsuarioById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  if (req.user?.id !== id && !req.user?.roles.includes('DIRECTOR')) {
    res.status(403).json({ error: 'Solo puedes ver tu propio perfil' })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: {
        id:            true,
        username:      true,
        roles:         true,
        activo:        true,
        creadoEn:      true,
        actualizadoEn: true,
        ...perfilesSelect,
      },
    })

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    res.status(200).json({ ...usuario, ...armarPerfiles(usuario) })
  } catch (error) {
    console.error('[usuario.getUsuarioById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/usuarios ───────────────────────────────────────────────────────
// Crea SOLO la cuenta de acceso (sin perfil/Persona). Útil para vincular
// después con /usuarios/:id/vincular a un perfil ya existente.
// Roles que puede asignar cada uno:
//   Director    → cualquier combinación
//   Secretaria  → solo ESTUDIANTE y/o TUTOR
export const createUsuario = async (req: Request, res: Response): Promise<void> => {
  const { username, password, roles } = req.body as {
    username?: string
    password?: string
    roles?: Rol[]
  }

  if (!username || !password || !roles || roles.length === 0) {
    res.status(400).json({ error: 'username, password y roles (arreglo no vacío) son obligatorios' })
    return
  }

  if (!roles.every(r => ROLES_VALIDOS.includes(r))) {
    res.status(400).json({ error: `Roles inválidos. Opciones: ${ROLES_VALIDOS.join(', ')}` })
    return
  }

  if (req.user?.roles.includes('SECRETARIA') && !req.user.roles.includes('DIRECTOR')) {
    if (!roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r))) {
      res.status(403).json({
        error: 'La Secretaria solo puede crear cuentas con rol ESTUDIANTE o TUTOR',
      })
      return
    }
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
    return
  }

  try {
    const existe = await prisma.usuario.findUnique({ where: { username } })
    if (existe) {
      res.status(409).json({ error: `El nombre de usuario "${username}" ya está en uso` })
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const usuario = await prisma.usuario.create({
      data: { username, passwordHash, roles, activo: true },
      select: { id: true, username: true, roles: true, activo: true, creadoEn: true },
    })

    res.status(201).json({
      ...usuario,
      mensaje: 'Usuario creado. Comparte las credenciales de forma segura.',
    })
  } catch (error) {
    console.error('[usuario.createUsuario]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/usuarios/:id ────────────────────────────────────────────────────
// Cambia los roles o el estado activo de la cuenta.
// OJO: agregar un rol acá NO crea el perfil correspondiente (Docente,
// Estudiante, etc.) — eso se hace con /usuarios/:id/vincular o creando
// el perfil directamente. Este endpoint solo toca la tabla Usuario.
export const updateUsuario = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { roles, activo } = req.body as {
    roles?:  Rol[]
    activo?: boolean
  }

  if (roles === undefined && activo === undefined) {
    res.status(400).json({ error: 'Debes enviar al menos "roles" o "activo"' })
    return
  }

  if (roles && (roles.length === 0 || !roles.every(r => ROLES_VALIDOS.includes(r)))) {
    res.status(400).json({ error: `roles debe ser un arreglo no vacío. Opciones: ${ROLES_VALIDOS.join(', ')}` })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    if (req.user?.id === id) {
      res.status(400).json({
        error: 'No puedes modificar tu propia cuenta desde este endpoint. Usa /auth/password para cambiar tu contraseña.',
      })
      return
    }

    // No puede existir el sistema sin al menos un Director activo
    const perdeRolDirector = usuario.roles.includes('DIRECTOR') && roles && !roles.includes('DIRECTOR')
    const seDesactiva      = activo === false && usuario.roles.includes('DIRECTOR')
    if (perdeRolDirector || seDesactiva) {
      const directoresActivos = await prisma.usuario.count({
        where: { roles: { has: 'DIRECTOR' }, activo: true },
      })
      if (directoresActivos <= 1) {
        res.status(400).json({
          error: 'No se puede quitar el rol DIRECTOR ni desactivar al único Director activo del sistema',
        })
        return
      }
    }

    const actualizado = await prisma.usuario.update({
      where: { id },
      data: {
        ...(roles  !== undefined && { roles }),
        ...(activo !== undefined && { activo }),
      },
      select: { id: true, username: true, roles: true, activo: true, actualizadoEn: true },
    })

    res.status(200).json(actualizado)
  } catch (error) {
    console.error('[usuario.updateUsuario]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/usuarios/:id/resetear ──────────────────────────────────────────
export const resetearPassword = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { nuevaPassword } = req.body as { nuevaPassword?: string }

  if (!nuevaPassword || nuevaPassword.length < 6) {
    res.status(400).json({ error: 'nuevaPassword debe tener al menos 6 caracteres' })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    if (req.user?.roles.includes('SECRETARIA') && !req.user.roles.includes('DIRECTOR')) {
      const soloEstudianteOTutor = usuario.roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r))
      if (!soloEstudianteOTutor) {
        res.status(403).json({
          error: 'La Secretaria solo puede resetear contraseñas de estudiantes y tutores',
        })
        return
      }
    }

    if (req.user?.id === id) {
      res.status(400).json({
        error: 'Para cambiar tu propia contraseña usa PUT /api/auth/password',
      })
      return
    }

    const passwordHash = await bcrypt.hash(nuevaPassword, 12)

    await prisma.usuario.update({
      where: { id },
      data:  { passwordHash },
    })

    res.status(200).json({
      message: `Contraseña reseteada para "${usuario.username}". Informa la nueva contraseña al usuario de forma segura.`,
    })
  } catch (error) {
    console.error('[usuario.resetearPassword]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── DELETE /api/usuarios/:id ─────────────────────────────────────────────────
// Elimina la CUENTA, no el perfil ni la Persona — los datos académicos
// se conservan para el historial.
export const deleteUsuario = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    if (req.user?.id === id) {
      res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' })
      return
    }

    if (usuario.roles.includes('DIRECTOR')) {
      const directoresActivos = await prisma.usuario.count({
        where: { roles: { has: 'DIRECTOR' }, activo: true },
      })
      if (directoresActivos <= 1) {
        res.status(400).json({
          error: 'No se puede eliminar el único Director activo del sistema',
        })
        return
      }
    }

    // Desvincular el usuario de TODOS sus perfiles antes de eliminar
    // (Director/Secretaria no se desvinculan porque su usuarioId no es
    // nullable en el schema — si el usuario tiene esos roles, primero
    // hay que reasignarles cuenta o eliminar el perfil manualmente).
    await prisma.$transaction(async tx => {
      if (usuario.roles.includes('DOCENTE')) {
        await tx.docente.updateMany({ where: { usuarioId: id }, data: { usuarioId: null } })
      }
      if (usuario.roles.includes('ESTUDIANTE')) {
        await tx.estudiante.updateMany({ where: { usuarioId: id }, data: { usuarioId: null } })
      }
      if (usuario.roles.includes('TUTOR')) {
        await tx.tutor.updateMany({ where: { usuarioId: id }, data: { usuarioId: null } })
      }
      await tx.usuario.delete({ where: { id } })
    })

    res.status(200).json({
      message: `Cuenta "${usuario.username}" eliminada. El perfil de la persona se conserva en el sistema.`,
    })
  } catch (error) {
    console.error('[usuario.deleteUsuario]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/usuarios/:id/vincular ──────────────────────────────────────────
// Vincula una cuenta existente a un perfil (Docente/Estudiante/Tutor)
// que ya existe sin cuenta. El usuario debe tener ese rol en su arreglo.
export const vincularPerfil = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { docenteId, estudianteId, tutorId } = req.body as {
    docenteId?:    number
    estudianteId?: number
    tutorId?:      number
  }

  const perfilId = docenteId ?? estudianteId ?? tutorId
  if (!perfilId) {
    res.status(400).json({ error: 'Debes enviar docenteId, estudianteId o tutorId' })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    if (docenteId && usuario.roles.includes('DOCENTE')) {
      await prisma.docente.update({ where: { id: docenteId }, data: { usuarioId: id } })
    } else if (estudianteId && usuario.roles.includes('ESTUDIANTE')) {
      await prisma.estudiante.update({ where: { id: estudianteId }, data: { usuarioId: id } })
    } else if (tutorId && usuario.roles.includes('TUTOR')) {
      await prisma.tutor.update({ where: { id: tutorId }, data: { usuarioId: id } })
    } else {
      res.status(400).json({
        error: `El perfil enviado no coincide con ninguno de los roles ("${usuario.roles.join(', ')}") del usuario`,
      })
      return
    }

    res.status(200).json({ message: 'Perfil vinculado correctamente al usuario' })
  } catch (error) {
    console.error('[usuario.vincularPerfil]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/usuarios/con-perfil ────────────────────────────────────────────
// Crea la cuenta + la Persona + un perfil de rol por cada rol en `roles`,
// todos apuntando a la misma Persona (ej. alguien que es Director Y
// Docente a la vez sigue siendo UNA sola persona con dos perfiles).
//
// Body:
//   { roles, username, password, persona: {...}, datosPorRol?: {...} }
export const createUsuarioConPerfil = async (req: Request, res: Response): Promise<void> => {
  const { roles, username, password, persona, datosPorRol } = req.body as {
    roles?: Rol[]
    username?: string
    password?: string
    persona?: PersonaInput
    datosPorRol?: DatosPorRol
  }

  if (!roles || roles.length === 0 || !username || !password || !persona) {
    res.status(400).json({
      error: 'roles (arreglo no vacío), username, password y persona son obligatorios',
    })
    return
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
    return
  }

  if (!roles.every(r => ROLES_VALIDOS.includes(r))) {
    res.status(400).json({ error: `Roles inválidos. Opciones: ${ROLES_VALIDOS.join(', ')}` })
    return
  }

  if (req.user?.roles.includes('SECRETARIA') && !req.user.roles.includes('DIRECTOR')) {
    if (!roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r))) {
      res.status(403).json({
        error: 'La Secretaria solo puede crear cuentas con rol ESTUDIANTE o TUTOR',
      })
      return
    }
  }

  const errorPersona = validarPersona(persona)
  if (errorPersona) {
    res.status(400).json({ error: errorPersona })
    return
  }

  try {
    const userExiste = await prisma.usuario.findUnique({ where: { username } })
    if (userExiste) {
      res.status(409).json({ error: `El username "${username}" ya está en uso` })
      return
    }

    // El CI ya es único a nivel de Persona (una sola tabla)
    const personaExiste = await buscarPersonaPorCi(persona.ci)
    if (personaExiste) {
      res.status(409).json({ error: `Ya existe una persona registrada con el CI ${persona.ci}` })
      return
    }

    // ¿Por qué validar desde Gestion y no desde Director?
    // Porque la FK vive en Gestion.directorId — Director ya no tiene gestionId.
    if (roles.includes('DIRECTOR') && datosPorRol?.DIRECTOR?.gestionId) {
      const gestionOcupada = await prisma.gestion.findUnique({
        where:  { id: datosPorRol.DIRECTOR.gestionId },
        select: { directorId: true, director: { select: { persona: { select: { nombre: true, apellido: true } } } } },
      })
      if (gestionOcupada?.directorId) {
        res.status(409).json({
          error: `La gestión ya tiene asignado a ${gestionOcupada.director?.persona.nombre} ${gestionOcupada.director?.persona.apellido}`,
        })
        return
      }
    }

    const resultado = await prisma.$transaction(async tx => {
      const usuario = await tx.usuario.create({
        data: { username, passwordHash: await bcrypt.hash(password, 12), roles, activo: true },
      })

      const personaCreada = await crearPersona(tx, persona)
      const perfiles = await crearPerfilesParaRoles(tx, roles, personaCreada.id, usuario.id, datosPorRol)

      return { usuario, persona: personaCreada, perfiles }
    })

    res.status(201).json({
      usuario: {
        id:       resultado.usuario.id,
        username: resultado.usuario.username,
        roles:    resultado.usuario.roles,
      },
      persona:  resultado.persona,
      perfiles: resultado.perfiles,
      credenciales: {
        username,
        password,
        nota: 'Comparte estas credenciales de forma segura',
      },
    })
  } catch (error) {
    console.error('[usuario.createUsuarioConPerfil]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}