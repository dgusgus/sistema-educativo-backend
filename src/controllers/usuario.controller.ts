import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { Rol } from '../../prisma/generated/prisma/enums.js'

// ─── GET /api/usuarios ────────────────────────────────────────────────────────
// ¿Por qué? El Director necesita ver quién tiene acceso al sistema,
// qué roles tienen asignados y si están activos o no.
export const getUsuarios = async (req: Request, res: Response): Promise<void> => {
  const { rol, activo, search } = req.query as {
    rol?:    string
    activo?: string
    search?: string
  }

  try {
    const usuarios = await prisma.usuario.findMany({
      where: {
        ...(rol    && { rol: rol as Rol }),
        ...(activo !== undefined && { activo: activo === 'true' }),
        ...(search && { username: { contains: search, mode: 'insensitive' } }),
      },
      select: {
        id:           true,
        username:     true,
        rol:          true,
        activo:       true,
        creadoEn:     true,
        actualizadoEn: true,
        // Incluir el perfil vinculado según el rol
        docente:    { select: { id: true, nombre: true, apellido: true, ci: true } },
        estudiante: { select: { id: true, nombre: true, apellido: true, ci: true } },
        tutor:      { select: { id: true, nombre: true, apellido: true, ci: true } },
        // NUNCA retornar passwordHash
      },
      orderBy: [{ rol: 'asc' }, { username: 'asc' }],
    })

    // Agregar campo "perfil" para simplificar el consumo en el frontend
    const resultado = usuarios.map(u => ({
      ...u,
      perfil: u.docente ?? u.estudiante ?? u.tutor ?? null,
    }))

    res.status(200).json(resultado)
  } catch (error) {
    console.error('[usuario.getUsuarios]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/usuarios/:id ────────────────────────────────────────────────────
// ¿Por qué? Para ver el detalle de un usuario específico y su perfil vinculado.
// Un usuario puede ver su propio perfil; el Director puede ver cualquiera.
export const getUsuarioById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  // Un usuario puede ver su propio perfil
  if (req.user?.id !== id && req.user?.rol !== 'DIRECTOR') {
    res.status(403).json({ error: 'Solo puedes ver tu propio perfil' })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: {
        id:            true,
        username:      true,
        rol:           true,
        activo:        true,
        creadoEn:      true,
        actualizadoEn: true,
        docente:    { select: { id: true, nombre: true, apellido: true, ci: true, especialidad: true } },
        estudiante: { select: { id: true, nombre: true, apellido: true, ci: true } },
        tutor:      { select: { id: true, nombre: true, apellido: true, ci: true, parentesco: true } },
      },
    })

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    res.status(200).json({
      ...usuario,
      perfil: usuario.docente ?? usuario.estudiante ?? usuario.tutor ?? null,
    })
  } catch (error) {
    console.error('[usuario.getUsuarioById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/usuarios ───────────────────────────────────────────────────────
// ¿Por qué? El Director crea cuentas para el personal (Secretaria, Docentes).
// La Secretaria crea cuentas para Estudiantes y Tutores.
// Roles que puede crear cada uno:
//   Director    → cualquier rol
//   Secretaria  → solo ESTUDIANTE y TUTOR
export const createUsuario = async (req: Request, res: Response): Promise<void> => {
  const { username, password, rol } = req.body as {
    username?: string
    password?: string
    rol?: Rol
  }

  if (!username || !password || !rol) {
    res.status(400).json({ error: 'username, password y rol son obligatorios' })
    return
  }

  // Validar que el rol sea válido
  const rolesValidos: Rol[] = ['DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR']
  if (!rolesValidos.includes(rol)) {
    res.status(400).json({
      error: `Rol inválido. Opciones: ${rolesValidos.join(', ')}`,
    })
    return
  }

  // Secretaria solo puede crear ESTUDIANTE y TUTOR
  if (req.user?.rol === 'SECRETARIA') {
    if (!['ESTUDIANTE', 'TUTOR'].includes(rol)) {
      res.status(403).json({
        error: 'La Secretaria solo puede crear cuentas con rol ESTUDIANTE o TUTOR',
      })
      return
    }
  }

  // Validar longitud mínima de contraseña
  if (password.length < 6) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
    return
  }

  try {
    // Verificar username único
    const existe = await prisma.usuario.findUnique({ where: { username } })
    if (existe) {
      res.status(409).json({ error: `El nombre de usuario "${username}" ya está en uso` })
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const usuario = await prisma.usuario.create({
      data: { username, passwordHash, rol, activo: true },
      select: {
        id: true, username: true, rol: true, activo: true, creadoEn: true,
      },
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
// ¿Por qué? Permite cambiar el rol o activar/desactivar un usuario.
// NO permite cambiar username ni password aquí — eso tiene sus propios endpoints.
// ¿Para qué? Si un docente también asume funciones administrativas, el Director
// puede cambiarle el rol sin crear una cuenta nueva.
export const updateUsuario = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { rol, activo } = req.body as {
    rol?:    Rol
    activo?: boolean
  }

  if (rol === undefined && activo === undefined) {
    res.status(400).json({ error: 'Debes enviar al menos "rol" o "activo"' })
    return
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    // No puede editarse a sí mismo (para evitar que el Director se bloquee)
    if (req.user?.id === id) {
      res.status(400).json({
        error: 'No puedes modificar tu propia cuenta desde este endpoint. Usa /auth/password para cambiar tu contraseña.',
      })
      return
    }

    // No puede existir el sistema sin al menos un Director activo
    if (usuario.rol === 'DIRECTOR' && activo === false) {
      const directoresActivos = await prisma.usuario.count({
        where: { rol: 'DIRECTOR', activo: true },
      })
      if (directoresActivos <= 1) {
        res.status(400).json({
          error: 'No se puede desactivar el único Director activo del sistema',
        })
        return
      }
    }

    const actualizado = await prisma.usuario.update({
      where: { id },
      data: {
        ...(rol    !== undefined && { rol }),
        ...(activo !== undefined && { activo }),
      },
      select: { id: true, username: true, rol: true, activo: true, actualizadoEn: true },
    })

    res.status(200).json(actualizado)
  } catch (error) {
    console.error('[usuario.updateUsuario]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/usuarios/:id/resetear ──────────────────────────────────────────
// ¿Por qué? Cuando un estudiante o tutor olvida su contraseña, necesita
// que alguien se la resetee SIN conocer la contraseña anterior.
// Es diferente a PUT /auth/password que requiere la contraseña actual.
// ¿Para qué? La Secretaria puede dar una contraseña temporal al tutor/estudiante
// para que pueda entrar y cambiarla desde su perfil.
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

    // Secretaria solo puede resetear contraseñas de ESTUDIANTE y TUTOR
    if (req.user?.rol === 'SECRETARIA') {
      if (!['ESTUDIANTE', 'TUTOR'].includes(usuario.rol)) {
        res.status(403).json({
          error: 'La Secretaria solo puede resetear contraseñas de estudiantes y tutores',
        })
        return
      }
    }

    // No puede resetearse a sí mismo desde aquí
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
// ¿Por qué? Cuando una persona ya no pertenece a la institución, su cuenta
// debe eliminarse para que no ocupe espacio ni sea un riesgo de seguridad.
// ¿Para qué? El Director puede eliminar cuentas de personas que ya se fueron.
// IMPORTANTE: No elimina al docente/estudiante/tutor — solo la cuenta de acceso.
// Los datos académicos se preservan para el historial.
export const deleteUsuario = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    // No puede eliminarse a sí mismo
    if (req.user?.id === id) {
      res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' })
      return
    }

    // Proteger el último Director activo
    if (usuario.rol === 'DIRECTOR') {
      const directoresActivos = await prisma.usuario.count({
        where: { rol: 'DIRECTOR', activo: true },
      })
      if (directoresActivos <= 1) {
        res.status(400).json({
          error: 'No se puede eliminar el único Director activo del sistema',
        })
        return
      }
    }

    // Desvincular el usuario de su perfil antes de eliminar
    // (los datos de la persona se conservan para el historial)
    await prisma.$transaction(async tx => {
      if (usuario.rol === 'DOCENTE') {
        await tx.docente.updateMany({
          where: { usuarioId: id },
          data:  { usuarioId: null },
        })
      } else if (usuario.rol === 'ESTUDIANTE') {
        await tx.estudiante.updateMany({
          where: { usuarioId: id },
          data:  { usuarioId: null },
        })
      } else if (usuario.rol === 'TUTOR') {
        await tx.tutor.updateMany({
          where: { usuarioId: id },
          data:  { usuarioId: null },
        })
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
// ¿Por qué? Cuando un docente ya existe en el sistema pero aún no tiene cuenta,
// el Director puede crear la cuenta y vincularla al perfil existente.
// ¿Para qué? Evita duplicar datos — el docente ya tiene CI, nombre, etc.
// Solo necesitamos darle acceso al sistema.
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

    // Vincular según el rol del usuario
    if (docenteId && usuario.rol === 'DOCENTE') {
      await prisma.docente.update({
        where: { id: docenteId },
        data:  { usuarioId: id },
      })
    } else if (estudianteId && usuario.rol === 'ESTUDIANTE') {
      await prisma.estudiante.update({
        where: { id: estudianteId },
        data:  { usuarioId: id },
      })
    } else if (tutorId && usuario.rol === 'TUTOR') {
      await prisma.tutor.update({
        where: { id: tutorId },
        data:  { usuarioId: id },
      })
    } else {
      res.status(400).json({
        error: `El perfil enviado no coincide con el rol "${usuario.rol}" del usuario`,
      })
      return
    }

    res.status(200).json({ message: 'Perfil vinculado correctamente al usuario' })
  } catch (error) {
    console.error('[usuario.vincularPerfil]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}