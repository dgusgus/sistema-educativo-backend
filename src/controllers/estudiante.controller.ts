import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'
import { leerExcel, generarExcel } from '../lib/excel.helper.js'
import { codigoCurso } from '../lib/curso.helper.js'   // si no existe en el backend, es el mismo que ya armamos del lado frontend — vale la pena tenerlo también acá
import { asyncHandler } from '../lib/asyncHandler.js'

// ─── GET /api/estudiantes ─────────────────────────────────────────────────────
export const getEstudiantes = async (req: Request, res: Response): Promise<void> => {
  const { search, cursoId, gestionId, estadoInscripcion } = req.query as {
    search?:    string
    cursoId?:   string
    gestionId?: string
    estadoInscripcion?: string
  }

  try {
    const estudiantes = await prisma.estudiante.findMany({
      where: {
        activo: true,
        persona: search
          ? {
              OR: [
                { nombre:   { contains: search, mode: 'insensitive' } },
                { apellido: { contains: search, mode: 'insensitive' } },
                { ci:       { contains: search } },
              ],
            }
          : undefined,
        inscripciones: cursoId || gestionId || estadoInscripcion
          ? {
              some: {
                ...(cursoId   && { cursoId:   Number(cursoId) }),
                ...(gestionId && { gestionId: Number(gestionId) }),
                // ⚠️ antes decía "estado" — el campo real es "estadoInscripcion"
                ...(estadoInscripcion && { estadoInscripcion: estadoInscripcion as any }),
              },
            }
          : undefined,
      },
      include: {
        persona: true,
        inscripciones: {
          include: {
            curso:   { select: { id: true, nivel: true, grado: true, paralelo: true } },
            gestion: { select: { id: true, anio: true, activa: true } },
          },
          orderBy: { gestion: { anio: 'desc' } },
          take: 1,
        },
        tutores: {
          include: {
            tutor: {
              select: {
                id: true,
                persona: { select: { nombre: true, apellido: true, telefono: true } },
              },
            },
          },
        },
        // ✅ faltaba — sin esto la lista nunca sabía si el estudiante ya
        // tenía cuenta, así que "Vincular cuenta" salía siempre en el
        // frontend aunque el estudiante ya tuviera una.
        usuario: { select: { id: true, username: true, activo: true } },
      },
      orderBy: { persona: { apellido: 'asc' } },
    })

    res.status(200).json(estudiantes.map(e => ({
      ...aplanarPersona(e),
      tutores: e.tutores.map(t => ({
        ...t,
        tutor: { id: t.tutor.id, ...t.tutor.persona },
      })),
    })))
  } catch (error) {
    console.error('[estudiante.getEstudiantes]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/estudiantes/:id ─────────────────────────────────────────────────
export const getEstudianteById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  // Control RBAC: si el usuario SOLO tiene roles de familia (estudiante
  // y/o tutor, sin ningún rol de staff), solo puede ver su propia info.
  const soloFamilia = req.user
    ? req.user.roles.every(r => ['ESTUDIANTE', 'TUTOR'].includes(r))
    : false

  if (soloFamilia) {
    if (req.user!.roles.includes('TUTOR')) {
      const tutorDelUsuario = await prisma.tutor.findFirst({ where: { usuarioId: req.user!.id } })
      if (tutorDelUsuario) {
        const vinculo = await prisma.tutorEstudiante.findFirst({
          where: { tutorId: tutorDelUsuario.id, estudianteId: id },
        })
        if (!vinculo) {
          res.status(403).json({ error: 'Sin permisos para ver este estudiante' })
          return
        }
      }
    } else {
      const estudianteDelUsuario = await prisma.estudiante.findFirst({ where: { usuarioId: req.user!.id } })
      if (estudianteDelUsuario?.id !== id) {
        res.status(403).json({ error: 'Solo puedes ver tu propia información' })
        return
      }
    }
  }

  try {
    const estudiante = await prisma.estudiante.findUnique({
      where: { id },
      include: {
        persona: true,
        usuario: { select: { id: true, username: true, roles: true, activo: true } },
        inscripciones: {
          include: { curso: true, gestion: true },
          orderBy: { gestion: { anio: 'desc' } },
        },
        tutores: {
          include: { tutor: { include: { persona: true } } },
        },
      },
    })

    if (!estudiante) {
      res.status(404).json({ error: 'Estudiante no encontrado' })
      return
    }

    res.status(200).json({
      ...aplanarPersona(estudiante),
      tutores: estudiante.tutores.map(t => ({ ...t, tutor: aplanarPersona(t.tutor) })),
    })
  } catch (error) {
    console.error('[estudiante.getEstudianteById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/estudiantes ────────────────────────────────────────────────────
export const createEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, fechaNacimiento, direccion, rude } = req.body as {
    ci?:              string
    nombre?:          string
    apellido?:        string
    fechaNacimiento?: string
    direccion?:       string
    rude?:            string
  }

  const persona: PersonaInput = {
    ci: ci ?? '', nombre: nombre ?? '', apellido: apellido ?? '', fechaNacimiento, direccion,
  }
  const errorPersona = validarPersona(persona)
  if (errorPersona) {
    res.status(400).json({ error: errorPersona })
    return
  }

  try {
    const existe = await buscarPersonaPorCi(persona.ci)
    if (existe) {
      res.status(409).json({ error: `Ya existe una persona registrada con el CI ${persona.ci}` })
      return
    }

    const estudiante = await prisma.$transaction(async tx => {
      const personaCreada = await crearPersona(tx, persona)
      return tx.estudiante.create({
        data:    { personaId: personaCreada.id, rude },
        include: { persona: true },
      })
    })

    res.status(201).json(aplanarPersona(estudiante))
  } catch (error) {
    console.error('[estudiante.createEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/estudiantes/:id ─────────────────────────────────────────────────
export const updateEstudiante = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { ci, nombre, apellido, fechaNacimiento, direccion, activo } = req.body as {
    ci?:              string
    nombre?:          string
    apellido?:        string
    fechaNacimiento?: string
    direccion?:       string
    activo?:          boolean
  }

  try {
    const existe = await prisma.estudiante.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Estudiante no encontrado' })
      return
    }

    // ✅ CI editable — con chequeo de unicidad excluyendo al propio registro
    if (ci !== undefined) {
      const otraPersona = await buscarPersonaPorCi(ci)
      if (otraPersona && otraPersona.id !== existe.personaId) {
        res.status(409).json({ error: `Ya existe una persona registrada con el CI ${ci}` })
        return
      }
    }

    if (ci !== undefined || nombre !== undefined || apellido !== undefined || fechaNacimiento !== undefined || direccion !== undefined) {
      await prisma.persona.update({
        where: { id: existe.personaId },
        data: {
          ...(ci              !== undefined && { ci }),
          ...(nombre          !== undefined && { nombre }),
          ...(apellido        !== undefined && { apellido }),
          ...(fechaNacimiento !== undefined && { fechaNacimiento: new Date(fechaNacimiento) }),
          ...(direccion       !== undefined && { direccion }),
        },
      })
    }

    const estudiante = await prisma.estudiante.update({
      where: { id },
      data:  { ...(activo !== undefined && { activo }) },
      include: { persona: true },
    })

    res.status(200).json(aplanarPersona(estudiante))
  } catch (error) {
    console.error('[estudiante.updateEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/inscripciones ──────────────────────────────────────────────────
export const inscribirEstudiante = async (req: Request, res: Response): Promise<void> => {
  const { estudianteId, cursoId, gestionId, procedencia } = req.body as {
    estudianteId?: number
    cursoId?:      number
    gestionId?:    number
    procedencia?:  string
  }

  if (!estudianteId || !cursoId || !gestionId) {
    res.status(400).json({ error: 'estudianteId, cursoId y gestionId son obligatorios' })
    return
  }

  try {
    const estudiante = await prisma.estudiante.findUnique({ where: { id: estudianteId } })
    if (!estudiante) {
      res.status(404).json({ error: 'Estudiante no encontrado' })
      return
    }

    // Validación amigable antes de que la FK compuesta (cursoId, gestionId)
    // -> Curso rechace el insert con un error de Postgres crudo.
    const curso = await prisma.curso.findUnique({ where: { id: cursoId } })
    if (!curso) {
      res.status(404).json({ error: 'Curso no encontrado' })
      return
    }
    if (curso.gestionId !== gestionId) {
      res.status(400).json({
        error: `El curso pertenece a la gestión ${curso.gestionId}, no a la gestión ${gestionId}`,
      })
      return
    }

    const duplicada = await prisma.inscripcion.findUnique({
      where: { estudianteId_gestionId: { estudianteId, gestionId } },
    })
    if (duplicada) {
      res.status(409).json({ error: 'El estudiante ya está inscrito en esta gestión' })
      return
    }

    const inscripcion = await prisma.inscripcion.create({
      data: { estudianteId, cursoId, gestionId, procedencia },
      include: {
        estudiante: { include: { persona: { select: { nombre: true, apellido: true } } } },
        curso:      true,
        gestion:    { select: { id: true, anio: true } },
      },
    })

    res.status(201).json({
      ...inscripcion,
      estudiante: aplanarPersona(inscripcion.estudiante),
    })
  } catch (error) {
    console.error('[estudiante.inscribirEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/inscripciones/:id ───────────────────────────────────────────────
export const getInscripcion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const inscripcion = await prisma.inscripcion.findUnique({
      where: { id },
      include: {
        estudiante: { include: { persona: true } },
        curso:      true,
        gestion:    true,
        pagos: {
          include: { conceptoPago: true },
          orderBy: { fechaPago: 'desc' },
        },
      },
    })

    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

    res.status(200).json({ ...inscripcion, estudiante: aplanarPersona(inscripcion.estudiante) })
  } catch (error) {
    console.error('[estudiante.getInscripcion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/inscripciones/:id/resultado ────────────────────────────────────
export const registrarResultado = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { resultado, observaciones } = req.body as {
    resultado?:    'PROMOVIDO' | 'REPROBADO'
    observaciones?: string
  }

  if (!resultado || !['PROMOVIDO', 'REPROBADO'].includes(resultado)) {
    res.status(400).json({ error: 'resultado debe ser PROMOVIDO o REPROBADO' })
    return
  }

  try {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id } })
    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

    const trimestresAbiertos = await prisma.trimestre.findMany({
      where: { gestionId: inscripcion.gestionId, cerrado: false },
    })
    if (trimestresAbiertos.length > 0) {
      res.status(400).json({
        error: 'No se puede registrar el resultado — hay trimestres sin cerrar',
        trimestresAbiertos: trimestresAbiertos.map(t => t.nombre),
      })
      return
    }

    const updated = await prisma.inscripcion.update({
      where: { id },
      data:  { resultado, observaciones },
      include: {
        estudiante: { include: { persona: { select: { nombre: true, apellido: true } } } },
        curso:      true,
        gestion:    { select: { anio: true } },
      },
    })

    res.status(200).json({ ...updated, estudiante: aplanarPersona(updated.estudiante) })
  } catch (error) {
    console.error('[estudiante.registrarResultado]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/inscripciones/:id/estado ────────────────────────────────────────
// Registra retiro o transferencia de un estudiante
export const cambiarEstadoInscripcion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { estadoInscripcion, fechaRetiro, observaciones } = req.body as {
    estadoInscripcion?: 'ACTIVA' | 'RETIRADA' | 'TRANSFERIDA' | 'CONCLUIDA'
    fechaRetiro?: string
    observaciones?: string
  }

  if (!estadoInscripcion) {
    res.status(400).json({ error: 'estadoInscripcion es obligatorio' })
    return
  }

  const estadosValidos = ['ACTIVA', 'RETIRADA', 'TRANSFERIDA', 'CONCLUIDA']
  if (!estadosValidos.includes(estadoInscripcion)) {
    res.status(400).json({ error: `Estado inválido. Opciones: ${estadosValidos.join(', ')}` })
    return
  }

  try {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id } })
    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

    const necesitaFecha = ['RETIRADA', 'TRANSFERIDA'].includes(estadoInscripcion)

    const actualizada = await prisma.inscripcion.update({
      where: { id },
      data: {
        estadoInscripcion,
        fechaRetiro: necesitaFecha
          ? (fechaRetiro ? new Date(fechaRetiro) : new Date())
          : null,
        ...(observaciones !== undefined && { observaciones }),
      },
      include: {
        estudiante: { include: { persona: { select: { nombre: true, apellido: true } } } },
        curso:      true,
      },
    })

    res.status(200).json({ ...actualizada, estudiante: aplanarPersona(actualizada.estudiante) })
  } catch (error) {
    console.error('[estudiante.cambiarEstadoInscripcion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── DELETE /api/inscripciones/:id ────────────────────────────────────────────
// "Desinscribir" — distinto de cambiarEstadoInscripcion(RETIRADA): esto
// borra la inscripción de verdad, para deshacer un error (curso
// equivocado, alta duplicada) ANTES de que tenga actividad real. Si ya
// tiene notas, asistencia o pagos cargados, se rechaza — ahí corresponde
// cambiar el estado a RETIRADA/TRANSFERIDA para no perder el historial.
export const eliminarInscripcion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id } })
    if (!inscripcion) {
      res.status(404).json({ error: 'Inscripción no encontrada' })
      return
    }

    const [calificaciones, asistencias, pagos] = await Promise.all([
      prisma.calificacion.count({ where: { inscripcionId: id } }),
      prisma.asistencia.count({ where: { inscripcionId: id } }),
      prisma.pago.count({ where: { inscripcionId: id } }),
    ])
    const totalActividad = calificaciones + asistencias + pagos

    if (totalActividad > 0) {
      res.status(400).json({
        error: 'No se puede desinscribir — ya tiene actividad registrada (notas, asistencia o pagos)',
        sugerencia: 'Usá "cambiar estado" a RETIRADA o TRANSFERIDA en su lugar, para conservar el historial',
        detalle: { calificaciones, asistencias, pagos },
      })
      return
    }

    await prisma.inscripcion.delete({ where: { id } })
    res.status(200).json({ message: 'Inscripción eliminada correctamente' })
  } catch (error) {
    console.error('[estudiante.eliminarInscripcion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/estudiantes/import ──────────────────────────────────────────
// Columnas esperadas: CI, Nombre, Apellido, FechaNacimiento, Direccion, RUDE, Curso
// (Curso en formato corto "1AS" — mismo código que ya usa el frontend)
export const importEstudiantes = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: 'Adjunta un archivo .xlsx' }); return }
  if (!req.body.gestionId) { res.status(400).json({ error: 'gestionId es obligatorio' }); return }
  const gestionId = Number(req.body.gestionId)

  const filas = await leerExcel(req.file.buffer, req.file.originalname)
  if (filas.length === 0) { res.status(400).json({ error: 'El archivo no tiene filas de datos' }); return }

  const cursos = await prisma.curso.findMany({ where: { gestionId } })
  const cursoPorCodigo = new Map(cursos.map(c => [codigoCurso(c), c]))

  const resultado = { totalFilas: filas.length, exitosas: 0, fallidas: 0, creados: [] as unknown[], errores: [] as Array<{ fila: number; error: string }> }

  for (const { fila, datos } of filas) {
    try {
      const ci        = String(datos['CI'] ?? '').trim()
      const nombre    = String(datos['Nombre'] ?? '').trim()
      const apellido  = String(datos['Apellido'] ?? '').trim()
      const cursoCod  = String(datos['Curso'] ?? '').trim().toUpperCase()

      if (!ci || !nombre || !apellido) throw new Error('CI, Nombre y Apellido son obligatorios')

      const yaExiste = await prisma.persona.findUnique({ where: { ci } })
      if (yaExiste) throw new Error(`Ya existe una persona con CI ${ci}`)

      const curso = cursoPorCodigo.get(cursoCod)
      if (cursoCod && !curso) throw new Error(`Curso "${cursoCod}" no encontrado en esta gestión`)

      const estudiante = await prisma.$transaction(async tx => {
        const persona = await tx.persona.create({
          data: {
            ci, nombre, apellido,
            direccion: datos['Direccion'] ? String(datos['Direccion']) : undefined,
          },
        })
        const est = await tx.estudiante.create({
          data: { personaId: persona.id, rude: datos['RUDE'] ? String(datos['RUDE']) : undefined },
        })
        if (curso) {
          await tx.inscripcion.create({ data: { estudianteId: est.id, cursoId: curso.id, gestionId } })
        }
        return est
      })

      resultado.creados.push(estudiante)
      resultado.exitosas++
    } catch (e) {
      resultado.fallidas++
      resultado.errores.push({ fila, error: e instanceof Error ? e.message : 'Error desconocido' })
    }
  }

  res.status(200).json(resultado)
})

// ─── GET /api/estudiantes/export?gestionId= ────────────────────────────────
export const exportEstudiantes = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const gestionId = Number(req.query.gestionId)
  const inscripciones = await prisma.inscripcion.findMany({
    where: { gestionId },
    include: { estudiante: { include: { persona: true } }, curso: true },
    orderBy: { estudiante: { persona: { apellido: 'asc' } } },
  })

  const filas = inscripciones.map(i => ({
    CI: i.estudiante.persona.ci,
    Nombre: i.estudiante.persona.nombre,
    Apellido: i.estudiante.persona.apellido,
    RUDE: i.estudiante.rude ?? '',
    Curso: codigoCurso(i.curso),
    Estado: i.estadoInscripcion,
  }))

  const buffer = await generarExcel('Estudiantes', ['CI', 'Nombre', 'Apellido', 'RUDE', 'Curso', 'Estado'], filas)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="estudiantes_gestion_${gestionId}.xlsx"`)
  res.send(buffer)
})

// ─── GET /api/estudiantes/plantilla ────────────────────────────────────────
export const plantillaEstudiantes = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const columnas = ['CI', 'Nombre', 'Apellido', 'FechaNacimiento', 'Direccion', 'RUDE', 'Curso']
  const ejemplo  = { CI: '4567890', Nombre: 'Sofía', Apellido: 'Condori Mamani', FechaNacimiento: '15/03/2010', Direccion: 'Av. 6 de Agosto 123', RUDE: '12345678', Curso: '1AS' }
  const buffer = await generarExcel('Plantilla', columnas, [ejemplo])
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_estudiantes.xlsx"')
  res.send(buffer)
})