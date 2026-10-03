import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'
import { leerExcel, generarExcel, texto, type ColumnaImport } from '../lib/excel.helper.js'
import { ejecutarImport, mensajeValidacion, sinTildes } from '../lib/import.helper.js'
import { ErrorDeUsuario } from '../lib/errores.js'
import { createTutorSchema } from '../schemas/persona.schema.js'
import { asyncHandler } from '../lib/asyncHandler.js'

// tutor.controller.ts — agregar arriba del todo, junto a los imports
const PARENTESCOS_VALIDOS = ['PADRE', 'MADRE', 'ABUELO', 'ABUELA', 'TIO', 'TIA', 'HERMANO', 'HERMANA', 'TUTOR_LEGAL', 'OTRO'] as const
type ParentescoValido = typeof PARENTESCOS_VALIDOS[number]

function normalizarParentesco(valor: string): ParentescoValido {
  const limpio = valor.trim().toUpperCase().replace(/\s+/g, '_')
  if (!PARENTESCOS_VALIDOS.includes(limpio as ParentescoValido)) {
    throw new ErrorDeUsuario(`Parentesco "${valor}" inválido — debe ser uno de: ${PARENTESCOS_VALIDOS.join(', ')}`)
  }
  return limpio as ParentescoValido
}
// GET /api/tutores
export const getTutores = async (req: Request, res: Response): Promise<void> => {
  const { search } = req.query as { search?: string }

  try {
    const tutores = await prisma.tutor.findMany({
      where: search
        ? {
            persona: {
              OR: [
                { nombre:   { contains: search, mode: 'insensitive' } },
                { apellido: { contains: search, mode: 'insensitive' } },
                { ci:       { contains: search } },
              ],
            },
          }
        : undefined,
      include: {
        persona: true,
        estudiantes: {
          include: {
            estudiante: {
              select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } },
            },
          },
        },
        usuario: { select: { id: true, username: true, activo: true } },
      },
      orderBy: { persona: { apellido: 'asc' } },
    })

    res.status(200).json(tutores.map(t => ({
      ...aplanarPersona(t),
      estudiantes: t.estudiantes.map(e => ({
        ...e,
        estudiante: { id: e.estudiante.id, ...e.estudiante.persona },
      })),
    })))
  } catch (error) {
    console.error('[tutor.getTutores]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// GET /api/tutores/:id
export const getTutorById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID inválido' })
    return
  }
  try {
    const tutor = await prisma.tutor.findUnique({
      where: { id },
      include: {
        persona: true,
        estudiantes: {
          include: {
            estudiante: {
              include: {
                persona: { select: { nombre: true, apellido: true, ci: true } },
                inscripciones: {
                  include: { curso: true, gestion: true },
                  orderBy: { gestion: { anio: 'desc' } },
                  take: 1,
                },
              },
            },
          },
        },
        usuario: { select: { id: true, username: true, activo: true } },
      },
    })
    if (!tutor) {
      res.status(404).json({ error: 'Tutor no encontrado' })
      return
    }
    res.status(200).json({
      ...aplanarPersona(tutor),
      estudiantes: tutor.estudiantes.map(e => ({
        ...e,
        estudiante: aplanarPersona(e.estudiante),
      })),
    })
  } catch (error) {
    console.error('[tutor.getTutorById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/tutores
export const createTutor = async (req: Request, res: Response): Promise<void> => {
  const { ci, nombre, apellido, telefono, email, ocupacion, gradoInstruccion } = req.body as {
    ci?: string
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    ocupacion?: string
    gradoInstruccion?: string
  }
  // ⚠️ "parentesco" ya NO va acá — ahora vive en TutorEstudiante (el
  // parentesco es respecto a CADA estudiante, no un atributo del tutor).
  // Se registra al vincular: POST /api/tutores/:id/vincular/:estudianteId

  const persona: PersonaInput = { ci: ci ?? '', nombre: nombre ?? '', apellido: apellido ?? '', telefono, email }
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

    const tutor = await prisma.$transaction(async tx => {
      const personaCreada = await crearPersona(tx, persona)
      return tx.tutor.create({
        data:    { personaId: personaCreada.id, ocupacion, gradoInstruccion },
        include: { persona: true },
      })
    })

    res.status(201).json(aplanarPersona(tutor))
  } catch (error) {
    console.error('[tutor.createTutor]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/tutores/:id
export const updateTutor = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID inválido' })
    return
  }
  const { ci, nombre, apellido, telefono, email, ocupacion, gradoInstruccion } = req.body as {
    ci?: string
    nombre?: string
    apellido?: string
    telefono?: string
    email?: string
    ocupacion?: string
    gradoInstruccion?: string
  }

  try {
    const existe = await prisma.tutor.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Tutor no encontrado' })
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

    if (ci !== undefined || nombre !== undefined || apellido !== undefined || telefono !== undefined || email !== undefined) {
      await prisma.persona.update({
        where: { id: existe.personaId },
        data: {
          ...(ci       !== undefined && { ci }),
          ...(nombre   !== undefined && { nombre }),
          ...(apellido !== undefined && { apellido }),
          ...(telefono !== undefined && { telefono }),
          ...(email    !== undefined && { email }),
        },
      })
    }

    const tutor = await prisma.tutor.update({
      where: { id },
      data: {
        ...(ocupacion        !== undefined && { ocupacion }),
        ...(gradoInstruccion !== undefined && { gradoInstruccion }),
      },
      include: { persona: true },
    })

    res.status(200).json(aplanarPersona(tutor))
  } catch (error) {
    console.error('[tutor.updateTutor]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// POST /api/tutores/:id/vincular/:estudianteId
// Acá SÍ va el parentesco — es un dato de la relación, no del tutor.
export const vincularEstudiante = async (req: Request, res: Response): Promise<void> => {
  const tutorId      = Number(req.params.id)
  const estudianteId = Number(req.params.estudianteId)
  const { parentesco, esTutorPrincipal, esApoderado, viveConEstudiante } = req.body as {
    parentesco?: string
    esTutorPrincipal?: boolean
    esApoderado?: boolean
    viveConEstudiante?: boolean
  }

  if (!parentesco) {
    res.status(400).json({ error: 'parentesco es obligatorio' })
    return
  }

  try {
    const existe = await prisma.tutorEstudiante.findUnique({
      where: { tutorId_estudianteId: { tutorId, estudianteId } },
    })
    if (existe) {
      res.status(409).json({ error: 'El tutor ya está vinculado a este estudiante' })
      return
    }

    const vinculo = await prisma.tutorEstudiante.create({
      data: {
        tutorId, estudianteId, parentesco: parentesco as any,
        esTutorPrincipal:  esTutorPrincipal  ?? false,
        esApoderado:       esApoderado       ?? false,
        viveConEstudiante: viveConEstudiante ?? true,
      },
      include: {
        tutor:      { select: { persona: { select: { nombre: true, apellido: true } } } },
        estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } },
      },
    })
    res.status(201).json({ message: 'Vinculación creada', vinculo })
  } catch (error) {
    console.error('[tutor.vincularEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// DELETE /api/tutores/:id/vincular/:estudianteId
export const desvincularEstudiante = async (req: Request, res: Response): Promise<void> => {
  const tutorId      = Number(req.params.id)
  const estudianteId = Number(req.params.estudianteId)

  try {
    await prisma.tutorEstudiante.delete({
      where: { tutorId_estudianteId: { tutorId, estudianteId } },
    })
    res.status(200).json({ message: 'Vinculación eliminada correctamente' })
  } catch (error) {
    console.error('[tutor.desvincularEstudiante]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/tutores/import ──────────────────────────────────────────────
// Columnas: CI, Nombre, Apellido, Ocupacion, GradoInstruccion, Email,
// Telefono, EstudianteCI (opcional), Parentesco (obligatorio SI viene EstudianteCI)
//
// Un tutor con varios hijos va en VARIAS filas con el mismo CI (una por hijo):
// es exactamente lo que genera el export. La primera fila crea al tutor y las
// siguientes solo agregan el vínculo con otro estudiante. Antes, la segunda fila
// fallaba con "Ya existe una persona con CI…" y el archivo exportado no se podía
// volver a importar.
// "Todo o nada por fila": si el estudiante no existe, esa fila entera falla.
const COLUMNAS_IMPORT_TUTOR: ColumnaImport[] = [
  { clave: 'CI',               obligatoria: true, alias: ['Cedula', 'Carnet', 'Cedula de identidad'] },
  { clave: 'Nombre',           obligatoria: true, alias: ['Nombres'] },
  { clave: 'Apellido',         obligatoria: true, alias: ['Apellidos'] },
  { clave: 'Ocupacion' },
  { clave: 'GradoInstruccion', alias: ['Grado de instruccion', 'Instruccion'] },
  { clave: 'Email',            alias: ['Correo', 'Correo electronico'] },
  { clave: 'Telefono',         alias: ['Celular', 'Cel'] },
  { clave: 'EstudianteCI',     alias: ['CI Estudiante', 'CI del estudiante', 'CI hijo'] },
  { clave: 'Parentesco' },
]

export const importTutores = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { filas, advertencias } = await leerExcel(req.file!.buffer, COLUMNAS_IMPORT_TUTOR)
  if (filas.length === 0) { res.status(400).json({ error: 'El archivo no tiene filas de datos' }); return }

  const seguro = (v: Parameters<typeof texto>[0]) => { try { return texto(v) } catch { return '' } }

  // Consultas únicas en vez de varias por fila
  const cis    = [...new Set(filas.map(f => seguro(f.datos.CI)).filter(Boolean))]
  const estCis = [...new Set(filas.map(f => seguro(f.datos.EstudianteCI)).filter(Boolean))]

  const personas = await prisma.persona.findMany({
    where:  { ci: { in: cis } },
    select: { ci: true, nombre: true, apellido: true, tutor: { select: { id: true } } },
  })
  const personaPorCi = new Map(personas.filter(p => p.ci !== null).map(p => [p.ci as string, p]))

  const estudiantes = estCis.length === 0 ? [] : await prisma.estudiante.findMany({
    where:  { persona: { ci: { in: estCis } } },
    select: { id: true, persona: { select: { ci: true } } },
  })
  const estudiantePorCi = new Map(estudiantes.map(e => [e.persona.ci as string, e.id]))

  // Tutores creados en ESTE archivo (para las filas siguientes del mismo CI)
  const creadosAqui = new Map<string, { tutorId: number; fila: number; nombre: string; apellido: string }>()

  const resultado = await ejecutarImport(filas, async ({ fila, datos }) => {
    const r = createTutorSchema.safeParse({
      ci:               texto(datos.CI),
      nombre:           texto(datos.Nombre),
      apellido:         texto(datos.Apellido),
      ocupacion:        texto(datos.Ocupacion) || undefined,
      gradoInstruccion: texto(datos.GradoInstruccion) || undefined,
      email:            texto(datos.Email) || undefined,
      telefono:         texto(datos.Telefono) || undefined,
    })
    if (!r.success) throw new ErrorDeUsuario(mensajeValidacion(r.error.issues))
    const v = r.data

    // Estudiante a vincular (opcional)
    const estudianteCi = texto(datos.EstudianteCI)
    const parentescoTxt = texto(datos.Parentesco)
    let estudianteId: number | null = null
    let parentesco: ParentescoValido | null = null
    if (estudianteCi) {
      estudianteId = estudiantePorCi.get(estudianteCi) ?? null
      if (estudianteId === null) throw new ErrorDeUsuario(`No se encontró un estudiante con CI ${estudianteCi}`)
      if (!parentescoTxt) throw new ErrorDeUsuario('Parentesco es obligatorio cuando se indica EstudianteCI')
      parentesco = normalizarParentesco(parentescoTxt)
    }

    // ¿Ya existe este tutor? (fila anterior del archivo, o registrado antes)
    const previo = creadosAqui.get(v.ci)
    const enBd   = personaPorCi.get(v.ci)
    let tutorId: number | null = null
    let referencia: { nombre: string; apellido: string } | null = null
    if (previo) {
      tutorId = previo.tutorId
      referencia = previo
    } else if (enBd) {
      if (!enBd.tutor) throw new ErrorDeUsuario(`Ya existe una persona con CI ${v.ci} que no está registrada como tutor`)
      tutorId = enBd.tutor.id
      referencia = enBd
    }

    if (tutorId !== null && referencia) {
      // Mismo CI con otro nombre casi seguro es un error de digitación: no se mezclan personas.
      if (sinTildes(`${v.nombre} ${v.apellido}`) !== sinTildes(`${referencia.nombre} ${referencia.apellido}`)) {
        throw new ErrorDeUsuario(`El CI ${v.ci} ya está registrado con otro nombre (${referencia.nombre} ${referencia.apellido})`)
      }
      if (estudianteId === null || parentesco === null) {
        throw new ErrorDeUsuario(`Ya existe un tutor con CI ${v.ci}${previo ? ` (fila ${previo.fila})` : ''}. Para agregarle otro hijo indica EstudianteCI y Parentesco`)
      }
      const yaVinculado = await prisma.tutorEstudiante.findFirst({ where: { tutorId, estudianteId }, select: { tutorId: true } })
      if (yaVinculado) throw new ErrorDeUsuario('Este tutor ya está vinculado a ese estudiante')
      return prisma.tutorEstudiante.create({ data: { tutorId, estudianteId, parentesco } })
    }

    // Tutor nuevo
    const tutor = await prisma.$transaction(async tx => {
      const persona = await crearPersona(tx, {
        ci: v.ci, nombre: v.nombre, apellido: v.apellido,
        email: v.email ?? undefined, telefono: v.telefono ?? undefined,
      })
      const t = await tx.tutor.create({
        data: {
          personaId: persona.id,
          ocupacion:        v.ocupacion ?? undefined,
          gradoInstruccion: v.gradoInstruccion ?? undefined,
        },
      })
      if (estudianteId !== null && parentesco !== null) {
        await tx.tutorEstudiante.create({ data: { tutorId: t.id, estudianteId, parentesco } })
      }
      return t
    })
    creadosAqui.set(v.ci, { tutorId: tutor.id, fila, nombre: v.nombre, apellido: v.apellido })
    return tutor
  })

  res.status(200).json({ ...resultado, advertencias })
})

// ─── GET /api/tutores/export ────────────────────────────────────────────────
// Un tutor con varios hijos vinculados genera una fila por cada vínculo
// (igual que se importaría) — un tutor sin ninguno genera una sola fila
// con EstudianteCI/Parentesco vacíos.
export const exportTutores = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tutores = await prisma.tutor.findMany({
    include: { persona: true, estudiantes: { include: { estudiante: { include: { persona: true } } } } },
    orderBy: { persona: { apellido: 'asc' } },
  })

  const filas: Record<string, unknown>[] = tutores.flatMap(t => {
    const base = {
      CI: t.persona.ci, Nombre: t.persona.nombre, Apellido: t.persona.apellido,
      Ocupacion: t.ocupacion ?? '', GradoInstruccion: t.gradoInstruccion ?? '',
      Email: t.persona.email ?? '', Telefono: t.persona.telefono ?? '',
    }
    if (t.estudiantes.length === 0) return [{ ...base, EstudianteCI: '', Parentesco: '' }]
    return t.estudiantes.map(v => ({
      ...base,
      EstudianteCI: v.estudiante.persona.ci,
      Parentesco: String(v.parentesco),   // ✅ enum → string, mismo tipo que la otra rama
    }))
  })

  const columnas = ['CI', 'Nombre', 'Apellido', 'Ocupacion', 'GradoInstruccion', 'Email', 'Telefono', 'EstudianteCI', 'Parentesco']
  const buffer = await generarExcel('Tutores', columnas, filas)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="tutores.xlsx"')
  res.send(buffer)
})

export const plantillaTutores = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const columnas = ['CI', 'Nombre', 'Apellido', 'Ocupacion', 'GradoInstruccion', 'Email', 'Telefono', 'EstudianteCI', 'Parentesco']
  const ejemplo  = { CI: '5678901', Nombre: 'Rosa', Apellido: 'Quispe Mamani', Ocupacion: 'Comerciante', GradoInstruccion: 'Secundaria', Email: 'rquispe@correo.com', Telefono: '71234567', EstudianteCI: '4567890', Parentesco: 'MADRE' }
  const buffer = await generarExcel('Plantilla', columnas, [ejemplo], {
    columnasTexto: ['CI', 'Telefono', 'EstudianteCI'],
    instrucciones: [
      { columna: 'CI',               obligatoria: true,  descripcion: 'Cédula de identidad del tutor', ejemplo: '5678901' },
      { columna: 'Nombre',           obligatoria: true,  descripcion: 'Nombres del tutor', ejemplo: 'Rosa' },
      { columna: 'Apellido',         obligatoria: true,  descripcion: 'Apellidos del tutor', ejemplo: 'Quispe Mamani' },
      { columna: 'Ocupacion',        obligatoria: false, descripcion: 'Ocupación', ejemplo: 'Comerciante' },
      { columna: 'GradoInstruccion', obligatoria: false, descripcion: 'Grado de instrucción', ejemplo: 'Secundaria' },
      { columna: 'Email',            obligatoria: false, descripcion: 'Correo electrónico', ejemplo: 'rquispe@correo.com' },
      { columna: 'Telefono',         obligatoria: false, descripcion: 'Un solo número (dígitos, + - ( ) y espacios)', ejemplo: '71234567' },
      { columna: 'EstudianteCI',     obligatoria: false, descripcion: 'CI de un estudiante YA registrado al que se vincula. Si el tutor tiene varios hijos, repite la fila con el mismo CI y otro EstudianteCI', ejemplo: '4567890' },
      { columna: 'Parentesco',       obligatoria: false, descripcion: 'Obligatorio si hay EstudianteCI: PADRE, MADRE, ABUELO, ABUELA, TIO, TIA, HERMANO, HERMANA, TUTOR_LEGAL u OTRO', ejemplo: 'MADRE' },
    ],
  })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_tutores.xlsx"')
  res.send(buffer)
})