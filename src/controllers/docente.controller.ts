import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona, personaExistenteParaPerfil } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'

import { leerExcel, generarExcel, texto, type ColumnaImport } from '../lib/excel.helper.js'
import { ejecutarImport, mensajeValidacion, sinTildes } from '../lib/import.helper.js'
import { ErrorDeUsuario } from '../lib/errores.js'
import { createDocenteSchema } from '../schemas/persona.schema.js'
import { asyncHandler } from '../lib/asyncHandler.js'

// ─── GET /api/docentes ────────────────────────────────────────────────────────
export const getDocentes = async (req: Request, res: Response): Promise<void> => {
  const { activo, search } = req.query as {
    activo?: string
    search?: string
  }

  try {
    const docentes = await prisma.docente.findMany({
      where: {
        activo: activo === 'false' ? false : true,
        persona: search
          ? {
              OR: [
                { nombre:   { contains: search, mode: 'insensitive' } },
                { apellido: { contains: search, mode: 'insensitive' } },
                { ci:       { contains: search } },
              ],
            }
          : undefined,
      },
      include: {
        persona: true,
        usuario: { select: { id: true, username: true, activo: true } },
        asignaciones: {
          where: { gestion: { activa: true } },
          include: {
            materia: { select: { id: true, nombre: true, codigo: true } },
            curso:   { select: { id: true, nivel: true, grado: true, paralelo: true } },
          },
        },
      },
      orderBy: { persona: { apellido: 'asc' } },
    })

    res.status(200).json(docentes.map(aplanarPersona))
  } catch (error) {
    console.error('[docente.getDocentes]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/docentes/:id ────────────────────────────────────────────────────
export const getDocenteById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID inválido' })
    return
  }

  try {
    const docente = await prisma.docente.findUnique({
      where: { id },
      include: {
        persona: true,
        usuario: { select: { id: true, username: true, roles: true, activo: true } },
        asignaciones: {
          include: {
            materia: true,
            curso:   true,
            gestion: { select: { id: true, anio: true, activa: true } },
            horarios: true,
          },
          orderBy: { gestion: { anio: 'desc' } },
        },
      },
    })

    if (!docente) {
      res.status(404).json({ error: 'Docente no encontrado' })
      return
    }

    res.status(200).json(aplanarPersona(docente))
  } catch (error) {
    console.error('[docente.getDocenteById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/docentes ───────────────────────────────────────────────────────
// Crea la Persona + el perfil Docente, SIN cuenta de acceso (usuarioId es
// nullable acá — a diferencia de Director/Secretaria, un docente puede
// existir en el sistema antes de tener usuario). Para vincularle cuenta,
// usar POST /api/usuarios/con-perfil o PUT /api/usuarios/:id/vincular.
export const createDocente = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, especialidad, telefono, email } = req.body as {
    ci?: string
    nombre?: string
    apellido?: string
    especialidad?: string
    telefono?: string
    email?: string
  }

  const persona: PersonaInput = { ci: ci ?? '', nombre: nombre ?? '', apellido: apellido ?? '', telefono, email }
  const errorPersona = validarPersona(persona)
  if (errorPersona) {
    res.status(400).json({ error: errorPersona })
    return
  }

  try {
    const docente = await prisma.$transaction(async tx => {
      // Si el CI ya es de la MISMA persona (p. ej. un docente que también es tutor) solo se le
      // agrega este perfil; si es de otra persona o ya tiene el perfil → ErrorDeUsuario 409.
      const previa = await personaExistenteParaPerfil(tx, persona, 'docente')
      const personaCreada = previa ?? await crearPersona(tx, persona)
      return tx.docente.create({
        data:    { personaId: personaCreada.id, especialidad },
        include: { persona: true },
      })
    })

    res.status(201).json(aplanarPersona(docente))
  } catch (error) {
    if (error instanceof ErrorDeUsuario) { res.status(error.status).json({ error: error.message }); return }
    // Dos altas simultáneas con el mismo CI: la BD rechaza la segunda (antes: error 500)
    if ((error as { code?: string }).code === 'P2002') { res.status(409).json({ error: `Ya existe un registro con el CI ${persona.ci}` }); return }
    console.error('[docente.createDocente]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/docentes/:id ────────────────────────────────────────────────────
export const updateDocente = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID inválido' })
    return
  }
  const { ci, nombre, apellido, especialidad, telefono, email, activo } = req.body as {
    ci?: string
    nombre?: string
    apellido?: string
    especialidad?: string
    telefono?: string
    email?: string
    activo?: boolean
  }

  try {
    const existe = await prisma.docente.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Docente no encontrado' })
      return
    }

    // ✅ CI editable — antes ni se leía del body. Como sigue siendo único
    // a nivel de Persona, hay que chequear que no pertenezca a OTRA persona
    // (buscarPersonaPorCi no excluye al propio registro).
    if (ci !== undefined) {
      const otraPersona = await buscarPersonaPorCi(ci)
      if (otraPersona && otraPersona.id !== existe.personaId) {
        res.status(409).json({ error: `Ya existe una persona registrada con el CI ${ci}` })
        return
      }
    }

    if (ci !== undefined || nombre !== undefined || apellido !== undefined || telefono !== undefined || email !== undefined) {
      await prisma.persona.update({
        where: { id: existe.personaId },
        data: {
          ...(ci        !== undefined && { ci }),
          ...(nombre    !== undefined && { nombre }),
          ...(apellido  !== undefined && { apellido }),
          ...(telefono  !== undefined && { telefono }),
          ...(email     !== undefined && { email }),
        },
      })
    }

    const docente = await prisma.docente.update({
      where: { id },
      data: {
        ...(especialidad !== undefined && { especialidad }),
        ...(activo       !== undefined && { activo }),
      },
      include: { persona: true },
    })

    res.status(200).json(aplanarPersona(docente))
  } catch (error) {
    console.error('[docente.updateDocente]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/docentes/:id/asignacion ───────────────────────────────────────
export const asignarMateriaCurso = async (req: Request, res: Response): Promise<void> => {
  const docenteId = Number(req.params.id)
  const { materiaId, cursoId, gestionId } = req.body as {
    materiaId?: number
    cursoId?: number
    gestionId?: number
  }

  if (!materiaId || !cursoId || !gestionId) {
    res.status(400).json({ error: 'materiaId, cursoId y gestionId son obligatorios' })
    return
  }

  try {
    const docente = await prisma.docente.findUnique({ where: { id: docenteId } })
    if (!docente) {
      res.status(404).json({ error: 'Docente no encontrado' })
      return
    }

    // Validación amigable ANTES del insert: si el curso no pertenece a
    // esta gestión, la FK compuesta (cursoId, gestionId) -> Curso lo
    // rechazaría igual a nivel de Postgres, pero con un error crudo.
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

    const duplicado = await prisma.docenteMateriaCurso.findUnique({
      where: {
        docenteId_materiaId_cursoId_gestionId: {
          docenteId, materiaId, cursoId, gestionId,
        },
      },
    })
    if (duplicado) {
      res.status(409).json({ error: 'Esta asignación ya existe' })
      return
    }

    // Un docente no puede tener dos materias en el mismo curso+gestión
    // con horarios que se pisen — acá solo advertimos si ya tiene
    // asignaciones en el curso; el cruce fino de horarios se valida en
    // horario.controller al crear el Horario.
    const conflicto = await prisma.docenteMateriaCurso.findFirst({
      where: { docenteId, gestionId, cursoId },
    })

    const asignacion = await prisma.docenteMateriaCurso.create({
      data: { docenteId, materiaId, cursoId, gestionId },
      include: {
        materia: true,
        curso:   true,
        gestion: { select: { id: true, anio: true } },
      },
    })

    res.status(201).json({
      ...asignacion,
      advertencia: conflicto ? 'El docente ya tiene asignaciones en este curso — revisa conflictos de horario.' : undefined,
    })
  } catch (error) {
    console.error('[docente.asignarMateriaCurso]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── DELETE /api/docentes/:id/asignacion/:asignacionId ───────────────────────
export const removeAsignacion = async (req: Request, res: Response): Promise<void> => {
  const docenteId    = Number(req.params.id)
  const asignacionId = Number(req.params.asignacionId)

  if (!Number.isInteger(docenteId) || docenteId <= 0 || !Number.isInteger(asignacionId) || asignacionId <= 0) {
    res.status(400).json({ error: 'id inválido' })
    return
  }

  try {
    // Debe ser una asignación DE ESE docente (antes se ignoraba el :id de la URL).
    const asignacion = await prisma.docenteMateriaCurso.findFirst({
      where:   { id: asignacionId, docenteId },
      include: {
        _count: {
          select: {
            calificaciones: true, asistencias: true, actividadesEvaluativas: true,
            bitacoras: true, promediosFinales: true, resumenAsistencias: true, horarios: true,
          },
        },
      },
    })
    if (!asignacion) {
      res.status(404).json({ error: 'Asignación no encontrada' })
      return
    }

    // Con notas, asistencia, actividades o bitácoras la base de datos NO permite borrar
    // (FK Restrict): se avisa con claridad en vez de devolver un 500 genérico.
    const c = asignacion._count
    const conDatos = [
      [c.calificaciones,          'calificaciones'],
      [c.asistencias,             'registros de asistencia'],
      [c.resumenAsistencias,      'resúmenes de asistencia'],
      [c.actividadesEvaluativas,  'actividades evaluativas'],
      [c.bitacoras,               'bitácoras de clase'],
      [c.promediosFinales,        'promedios finales'],
    ].filter(([n]) => (n as number) > 0).map(([n, txt]) => `${n} ${txt}`)

    if (conDatos.length) {
      res.status(409).json({
        error: `No se puede quitar la asignación porque ya tiene registros: ${conDatos.join(', ')}. Solo se puede quitar una asignación sin actividad.`,
      })
      return
    }

    // Los horarios de la asignación se eliminan con ella (cascada).
    await prisma.docenteMateriaCurso.delete({ where: { id: asignacionId } })

    res.status(200).json({ message: 'Asignación eliminada correctamente', horariosEliminados: c.horarios })
  } catch (error) {
    // Red de seguridad: otra tabla con registros aparecida entre la consulta y el borrado.
    if ((error as { code?: string }).code === 'P2003') {
      res.status(409).json({ error: 'No se puede quitar la asignación porque ya tiene registros asociados' })
      return
    }
    console.error('[docente.removeAsignacion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/docentes/mis-cursos ─────────────────────────────────────────────
// El docente ve todas sus asignaciones activas con los estudiantes de
// cada curso
export const getMisCursos = async (req: Request, res: Response): Promise<void> => {
  try {
    const docente = await prisma.docente.findFirst({
      where:   { usuarioId: req.user!.id },
      include: { persona: { select: { nombre: true, apellido: true } } },
    })

    if (!docente) {
      res.status(404).json({ error: 'Perfil de docente no encontrado' })
      return
    }

    const asignaciones = await prisma.docenteMateriaCurso.findMany({
      where: {
        docenteId: docente.id,
        gestion:   { activa: true },
      },
      include: {
        materia:  true,
        gestion:  { select: { id: true, anio: true } },
        horarios: { orderBy: { diaSemana: 'asc' } },
        curso: {
          include: {
            inscripciones: {
              include: {
                estudiante: {
                  select: {
                    id: true,
                    persona: { select: { nombre: true, apellido: true, ci: true } },
                  },
                },
              },
              orderBy: { estudiante: { persona: { apellido: 'asc' } } },
            },
          },
        },
      },
      orderBy: [
        { curso:   { nivel:  'asc' } },
        { materia: { nombre: 'asc' } },
      ],
    })

    const resultado = asignaciones.map(a => ({
      docenteMateriaCursoId: a.id,
      materia:  { id: a.materia.id, nombre: a.materia.nombre },
      curso:    { id: a.curso.id, nivel: a.curso.nivel, grado: a.curso.grado, paralelo: a.curso.paralelo },
      gestion:  a.gestion,
      horarios: a.horarios,
      totalEstudiantes: a.curso.inscripciones.length,
      estudiantes: a.curso.inscripciones.map(i => ({
        inscripcionId: i.id,
        id:            i.estudiante.id,
        ...i.estudiante.persona,
      })),
    }))

    res.status(200).json({
      docente: {
        id:       docente.id,
        nombre:   docente.persona.nombre,
        apellido: docente.persona.apellido,
      },
      totalAsignaciones: resultado.length,
      asignaciones:      resultado,
    })
  } catch (error) {
    console.error('[docente.getMisCursos]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/docentes/import ─────────────────────────────────────────────
// Columnas: CI, Nombre, Apellido, Especialidad, Email, Telefono
// No crea cuenta de acceso (mismo criterio que createDocente) — la
// asignación materia+curso tampoco se hace acá, es un paso aparte.
const COLUMNAS_IMPORT_DOCENTE: ColumnaImport[] = [
  { clave: 'CI',           obligatoria: true, alias: ['Cedula', 'Carnet', 'Cedula de identidad'] },
  { clave: 'Nombre',       obligatoria: true, alias: ['Nombres'] },
  { clave: 'Apellido',     obligatoria: true, alias: ['Apellidos'] },
  { clave: 'Especialidad' },
  { clave: 'Email',        alias: ['Correo', 'Correo electronico'] },
  { clave: 'Telefono',     alias: ['Celular', 'Cel'] },
]

export const importDocentes = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { filas, advertencias } = await leerExcel(req.file!.buffer, COLUMNAS_IMPORT_DOCENTE)
  if (filas.length === 0) { res.status(400).json({ error: 'El archivo no tiene filas de datos' }); return }

  const cisEnArchivo = [...new Set(filas.map(f => { try { return texto(f.datos.CI) } catch { return '' } }).filter(Boolean))]
  const personas = await prisma.persona.findMany({
    where:  { ci: { in: cisEnArchivo } },
    select: { id: true, ci: true, nombre: true, apellido: true, docente: { select: { id: true } } },
  })
  const personaPorCi = new Map(personas.filter(p => p.ci !== null).map(p => [p.ci as string, p]))
  const vistos = new Map<string, number>()

  const resultado = await ejecutarImport(filas, async ({ fila, datos }) => {
    const r = createDocenteSchema.safeParse({
      ci:           texto(datos.CI),
      nombre:       texto(datos.Nombre),
      apellido:     texto(datos.Apellido),
      especialidad: texto(datos.Especialidad) || undefined,
      email:        texto(datos.Email) || undefined,
      telefono:     texto(datos.Telefono) || undefined,
    })
    if (!r.success) throw new ErrorDeUsuario(mensajeValidacion(r.error.issues))
    const v = r.data

    const previa = vistos.get(v.ci)
    if (previa !== undefined) throw new ErrorDeUsuario(`CI duplicado en el archivo (ya aparece en la fila ${previa})`)
    vistos.set(v.ci, fila)
    // Si el CI ya es de la MISMA persona (p. ej. un tutor que también es docente) solo se le agrega
    // el perfil de docente; con otro nombre se rechaza (casi seguro un error de digitación).
    const enBd = personaPorCi.get(v.ci)
    if (enBd) {
      if (enBd.docente) throw new ErrorDeUsuario(`Ya existe un docente con CI ${v.ci}`)
      if (sinTildes(`${v.nombre} ${v.apellido}`) !== sinTildes(`${enBd.nombre} ${enBd.apellido}`)) {
        throw new ErrorDeUsuario(`El CI ${v.ci} ya está registrado a nombre de ${enBd.nombre} ${enBd.apellido}`)
      }
    }

    return prisma.$transaction(async tx => {
      const personaId = enBd
        ? enBd.id
        : (await crearPersona(tx, {
            ci: v.ci, nombre: v.nombre, apellido: v.apellido,
            email: v.email ?? undefined, telefono: v.telefono ?? undefined,
          })).id
      return tx.docente.create({ data: { personaId, especialidad: v.especialidad ?? undefined } })
    })
  })

  res.status(200).json({ ...resultado, advertencias })
})

// ─── GET /api/docentes/export ──────────────────────────────────────────────
export const exportDocentes = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const docentes = await prisma.docente.findMany({
    include: { persona: true },
    orderBy: { persona: { apellido: 'asc' } },
  })
  const filas = docentes.map(d => ({
    CI: d.persona.ci, Nombre: d.persona.nombre, Apellido: d.persona.apellido,
    Especialidad: d.especialidad ?? '', Email: d.persona.email ?? '', Telefono: d.persona.telefono ?? '',
    Activo: d.activo ? 'Sí' : 'No',
  }))
  const buffer = await generarExcel('Docentes', ['CI', 'Nombre', 'Apellido', 'Especialidad', 'Email', 'Telefono', 'Activo'], filas)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="docentes.xlsx"')
  res.send(buffer)
})

export const plantillaDocentes = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const columnas = ['CI', 'Nombre', 'Apellido', 'Especialidad', 'Email', 'Telefono']
  const ejemplo  = { CI: '3456789', Nombre: 'Carlos', Apellido: 'Flores Huanca', Especialidad: 'Inglés y Ed. Física', Email: 'cflores@correo.com', Telefono: '70123456' }
  const buffer = await generarExcel('Plantilla', columnas, [ejemplo], {
    columnasTexto: ['CI', 'Telefono'],
    instrucciones: [
      { columna: 'CI',           obligatoria: true,  descripcion: 'Cédula de identidad (con complemento si lo tiene)', ejemplo: '3456789' },
      { columna: 'Nombre',       obligatoria: true,  descripcion: 'Nombres del docente', ejemplo: 'Carlos' },
      { columna: 'Apellido',     obligatoria: true,  descripcion: 'Apellidos del docente', ejemplo: 'Flores Huanca' },
      { columna: 'Especialidad', obligatoria: false, descripcion: 'Área o materias que enseña', ejemplo: 'Inglés y Ed. Física' },
      { columna: 'Email',        obligatoria: false, descripcion: 'Correo electrónico', ejemplo: 'cflores@correo.com' },
      { columna: 'Telefono',     obligatoria: false, descripcion: 'Un solo número (dígitos, + - ( ) y espacios)', ejemplo: '70123456' },
    ],
  })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_docentes.xlsx"')
  res.send(buffer)
})