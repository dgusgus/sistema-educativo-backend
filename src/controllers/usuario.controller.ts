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

    // También se limpia el bloqueo por intentos fallidos: si el usuario
    // estaba bloqueado, el reseteo debe dejarlo poder entrar con la clave nueva.
    await prisma.usuario.update({
      where: { id },
      data:  { passwordHash, intentosFallidos: 0, bloqueadoHasta: null },
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
      const existe = await prisma.docente.findUnique({ where: { id: docenteId } })
      if (!existe) {
        res.status(404).json({ error: `No existe un docente con id ${docenteId}` })
        return
      }
      await prisma.docente.update({ where: { id: docenteId }, data: { usuarioId: id } })
    } else if (estudianteId && usuario.roles.includes('ESTUDIANTE')) {
      const existe = await prisma.estudiante.findUnique({ where: { id: estudianteId } })
      if (!existe) {
        res.status(404).json({ error: `No existe un estudiante con id ${estudianteId}` })
        return
      }
      await prisma.estudiante.update({ where: { id: estudianteId }, data: { usuarioId: id } })
    } else if (tutorId && usuario.roles.includes('TUTOR')) {
      const existe = await prisma.tutor.findUnique({ where: { id: tutorId } })
      if (!existe) {
        res.status(404).json({ error: `No existe un tutor con id ${tutorId}` })
        return
      }
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
// ─── Roles de personal que se pueden sumar/quitar a una misma persona ────────
const ROLES_PERSONAL = ['DIRECTOR', 'SECRETARIA', 'DOCENTE'] as const
type RolPersonal = typeof ROLES_PERSONAL[number]
const esRolPersonal = (r: unknown): r is RolPersonal => ROLES_PERSONAL.includes(r as RolPersonal)
const claveDePerfil = { DIRECTOR: 'director', SECRETARIA: 'secretaria', DOCENTE: 'docente' } as const

class Rechazo extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// ─── POST /api/usuarios/habilitar-rol ────────────────────────────────────────
// Suma un rol de personal (DIRECTOR / SECRETARIA / DOCENTE) a una persona que
// YA existe, sin volver a crear sus datos: reutiliza la misma Persona, crea (o
// reactiva) el perfil y agrega el rol a su cuenta. Sirve para "un Director que
// también es Docente" y viceversa.
//
// Body: { usuarioId? | personaId?, rol, especialidad?, gestionId?, username?, password? }
//   • Si la persona ya tiene cuenta (en cualquiera de sus perfiles) se reutiliza.
//   • Si no tiene cuenta (p. ej. un Docente sin acceso que pasa a Director) hay
//     que enviar username y password para crearla.
export const habilitarRol = async (req: Request, res: Response): Promise<void> => {
  const { usuarioId, personaId, rol, especialidad, gestionId, username, password } = req.body as {
    usuarioId?: number; personaId?: number; rol?: Rol
    especialidad?: string; gestionId?: number; username?: string; password?: string
  }

  if (!esRolPersonal(rol)) {
    res.status(400).json({ error: `rol debe ser uno de: ${ROLES_PERSONAL.join(', ')}` })
    return
  }
  if (!usuarioId && !personaId) {
    res.status(400).json({ error: 'Debes enviar usuarioId o personaId' })
    return
  }

  try {
    const resultado = await prisma.$transaction(async tx => {
      // 1. Resolver la persona
      const incluirPerfiles = { director: true, secretaria: true, docente: true } as const
      let persona: any = null
      if (personaId) {
        persona = await tx.persona.findUnique({ where: { id: personaId }, include: incluirPerfiles })
      } else {
        const u = await tx.usuario.findUnique({
          where: { id: usuarioId! },
          include: { director: true, secretaria: true, docente: true, estudiante: true, tutor: true },
        })
        if (!u) throw new Rechazo(404, 'Usuario no encontrado')
        const pid = (u.director ?? u.secretaria ?? u.docente ?? u.estudiante ?? u.tutor)?.personaId
        if (!pid) throw new Rechazo(400, 'La cuenta no tiene una persona vinculada')
        persona = await tx.persona.findUnique({ where: { id: pid }, include: incluirPerfiles })
      }
      if (!persona) throw new Rechazo(404, 'Persona no encontrada')

      // 2. Resolver la cuenta (reutilizar la que ya tenga; si no, crearla)
      let cuentaId: number | null =
        usuarioId ?? persona.director?.usuarioId ?? persona.secretaria?.usuarioId ?? persona.docente?.usuarioId ?? null
      let credenciales: { username: string; password: string } | null = null

      if (!cuentaId) {
        if (!username || !password) {
          throw new Rechazo(400, `${persona.nombre} ${persona.apellido} no tiene cuenta de acceso: envía username y password para crearla`)
        }
        if (password.length < 6) throw new Rechazo(400, 'La contraseña debe tener al menos 6 caracteres')
        if (await tx.usuario.findUnique({ where: { username } })) {
          throw new Rechazo(409, `El username "${username}" ya está en uso`)
        }
        const nuevo = await tx.usuario.create({
          data: { username, passwordHash: await bcrypt.hash(password, 12), roles: [rol], activo: true },
        })
        cuentaId    = nuevo.id
        credenciales = { username, password }

        // Si la persona ya era Docente sin cuenta, esa cuenta nueva también es la suya:
        // se liga el perfil docente y se suma el rol (un solo login para todo).
        if (persona.docente && !persona.docente.usuarioId && rol !== 'DOCENTE') {
          await tx.docente.update({ where: { id: persona.docente.id }, data: { usuarioId: nuevo.id } })
          await tx.usuario.update({ where: { id: nuevo.id }, data: { roles: [rol, 'DOCENTE'] } })
          persona.docente.usuarioId = nuevo.id
        }
      }

      const cuenta = await tx.usuario.findUniqueOrThrow({ where: { id: cuentaId } })

      // 3. Crear / reactivar el perfil
      const clave  = claveDePerfil[rol]
      const actual = persona[clave] as { id: number; activo: boolean; usuarioId: number | null } | null

      if (actual && actual.usuarioId && actual.usuarioId !== cuenta.id) {
        throw new Rechazo(409, `El perfil de ${rol.toLowerCase()} de esta persona está ligado a otra cuenta`)
      }
      if (actual && actual.activo && cuenta.roles.includes(rol) && actual.usuarioId === cuenta.id) {
        throw new Rechazo(409, `Esta persona ya es ${rol.toLowerCase()} y tiene el rol habilitado`)
      }

      if (rol === 'DIRECTOR' && gestionId) {
        const g = await tx.gestion.findUnique({ where: { id: gestionId }, select: { directorId: true } })
        if (!g) throw new Rechazo(404, 'La gestión indicada no existe')
        if (g.directorId && g.directorId !== actual?.id) throw new Rechazo(409, 'Esa gestión ya tiene un director asignado')
      }

      let perfil: any
      if (actual) {
        perfil = await (tx as any)[clave].update({
          where: { id: actual.id },
          data:  { activo: true, usuarioId: cuenta.id, ...(rol === 'DOCENTE' && especialidad ? { especialidad } : {}) },
        })
      } else {
        perfil = await (tx as any)[clave].create({
          data: { personaId: persona.id, usuarioId: cuenta.id, ...(rol === 'DOCENTE' ? { especialidad } : {}) },
        })
      }
      if (rol === 'DIRECTOR' && gestionId) {
        await tx.gestion.update({ where: { id: gestionId }, data: { directorId: perfil.id } })
      }

      // 4. Agregar el rol a la cuenta (y reactivarla si estaba inactiva por este perfil)
      const roles = cuenta.roles.includes(rol) ? cuenta.roles : [...cuenta.roles, rol]
      const usuario = await tx.usuario.update({
        where:  { id: cuenta.id },
        data:   { roles },
        select: { id: true, username: true, roles: true, activo: true },
      })

      return { usuario, perfil, credenciales, persona: { id: persona.id, nombre: persona.nombre, apellido: persona.apellido, ci: persona.ci } }
    })

    res.status(201).json({
      ...resultado,
      mensaje: `${resultado.persona.nombre} ${resultado.persona.apellido} ahora también es ${rol.toLowerCase()}. ` +
               'Para ver el nuevo rol debe volver a iniciar sesión.',
    })
  } catch (error) {
    if (error instanceof Rechazo) {
      res.status(error.status).json({ error: error.message })
      return
    }
    console.error('[usuario.habilitarRol]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/usuarios/:id/quitar-rol ───────────────────────────────────────
// Quita un rol de personal a la cuenta y desactiva ese perfil (no se borra:
// se conserva el historial). La cuenta debe quedar con al menos otro rol.
export const quitarRol = async (req: Request, res: Response): Promise<void> => {
  const id  = Number(req.params.id)
  const { rol } = req.body as { rol?: Rol }

  if (!esRolPersonal(rol)) {
    res.status(400).json({ error: `rol debe ser uno de: ${ROLES_PERSONAL.join(', ')}` })
    return
  }
  if (req.user?.id === id) {
    res.status(400).json({ error: 'No puedes quitarte un rol a ti mismo; pídelo a otro Director' })
    return
  }

  try {
    await prisma.$transaction(async tx => {
      const u = await tx.usuario.findUnique({
        where: { id },
        include: { director: true, secretaria: true, docente: true },
      })
      if (!u) throw new Rechazo(404, 'Usuario no encontrado')
      if (!u.roles.includes(rol)) throw new Rechazo(400, `La cuenta no tiene el rol ${rol}`)
      if (u.roles.length === 1) {
        throw new Rechazo(400, 'Es el único rol de la cuenta. Para quitar el acceso desactiva la cuenta.')
      }

      if (rol === 'DIRECTOR') {
        const otros = await tx.usuario.count({ where: { roles: { has: 'DIRECTOR' }, activo: true, id: { not: id } } })
        if (otros < 1) throw new Rechazo(400, 'No se puede quitar el rol al único Director activo del sistema')
        if (u.director) {
          const g = await tx.gestion.count({ where: { directorId: u.director.id, activa: true } })
          if (g > 0) throw new Rechazo(409, 'Es el director de la gestión activa: asigna otro director a la gestión primero')
        }
      }
      if (rol === 'DOCENTE' && u.docente) {
        const asig = await tx.docenteMateriaCurso.count({ where: { docenteId: u.docente.id, gestion: { activa: true } } })
        if (asig > 0) throw new Rechazo(409, `Tiene ${asig} materia(s) asignada(s) en la gestión activa: reasígnalas primero`)
        const tut = await tx.curso.count({ where: { tutorDocenteId: u.docente.id, gestion: { activa: true } } })
        if (tut > 0) throw new Rechazo(409, `Es tutor de ${tut} curso(s) en la gestión activa: cambia el tutor primero`)
      }

      const clave = claveDePerfil[rol]
      const perfil = (u as any)[clave]
      if (perfil) await (tx as any)[clave].update({ where: { id: perfil.id }, data: { activo: false } })
      await tx.usuario.update({ where: { id }, data: { roles: u.roles.filter(r => r !== rol) } })
    })

    res.status(200).json({ message: `Rol ${rol} retirado. Los datos históricos se conservan.` })
  } catch (error) {
    if (error instanceof Rechazo) {
      res.status(error.status).json({ error: error.message })
      return
    }
    console.error('[usuario.quitarRol]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}