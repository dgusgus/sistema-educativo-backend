import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { crearPersona, buscarPersonaPorCi, aplanarPersona, validarPersona } from '../lib/persona.helper.js'
import type { PersonaInput } from '../lib/persona.helper.js'
import { leerExcel, generarExcel } from '../lib/excel.helper.js'
import { asyncHandler } from '../lib/asyncHandler.js'

// tutor.controller.ts — agregar arriba del todo, junto a los imports
const PARENTESCOS_VALIDOS = ['PADRE', 'MADRE', 'ABUELO', 'ABUELA', 'TIO', 'TIA', 'HERMANO', 'HERMANA', 'TUTOR_LEGAL', 'OTRO'] as const
type ParentescoValido = typeof PARENTESCOS_VALIDOS[number]

function normalizarParentesco(valor: string): ParentescoValido {
  const limpio = valor.trim().toUpperCase().replace(/\s+/g, '_')
  if (!PARENTESCOS_VALIDOS.includes(limpio as ParentescoValido)) {
    throw new Error(`Parentesco "${valor}" inválido — debe ser uno de: ${PARENTESCOS_VALIDOS.join(', ')}`)
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
// Si EstudianteCI viene y existe, vincula al tutor con ese estudiante en
// la misma transacción — si no existe, la fila entera falla (mismo
// criterio "todo o nada por fila" que el resto de los imports).
export const importTutores = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: 'Adjunta un archivo .xlsx' }); return }
  const filas = await leerExcel(req.file.buffer, req.file.originalname)
  if (filas.length === 0) { res.status(400).json({ error: 'El archivo no tiene filas de datos' }); return }

  const resultado = { totalFilas: filas.length, exitosas: 0, fallidas: 0, creados: [] as unknown[], errores: [] as Array<{ fila: number; error: string }> }

  for (const { fila, datos } of filas) {
    try {
      const ci       = String(datos['CI'] ?? '').trim()
      const nombre   = String(datos['Nombre'] ?? '').trim()
      const apellido = String(datos['Apellido'] ?? '').trim()
      if (!ci || !nombre || !apellido) throw new Error('CI, Nombre y Apellido son obligatorios')

      const yaExiste = await buscarPersonaPorCi(ci)
      if (yaExiste) throw new Error(`Ya existe una persona con CI ${ci}`)

      const estudianteCi = datos['EstudianteCI'] ? String(datos['EstudianteCI']).trim() : ''
      const parentesco = datos['Parentesco'] ? normalizarParentesco(String(datos['Parentesco'])) : ''

      let estudiante = null
      if (estudianteCi) {
        estudiante = await prisma.estudiante.findFirst({ where: { persona: { ci: estudianteCi } } })
        if (!estudiante) throw new Error(`No se encontró un estudiante con CI ${estudianteCi}`)
        if (!parentesco) throw new Error('Parentesco es obligatorio cuando se indica EstudianteCI')
      }

      const tutor = await prisma.$transaction(async tx => {
        const persona = await crearPersona(tx, {
          ci, nombre, apellido,
          email:    datos['Email']    ? String(datos['Email'])    : undefined,
          telefono: datos['Telefono'] ? String(datos['Telefono']) : undefined,
        })
        const t = await tx.tutor.create({
          data: {
            personaId: persona.id,
            ocupacion:        datos['Ocupacion']        ? String(datos['Ocupacion'])        : undefined,
            gradoInstruccion: datos['GradoInstruccion']  ? String(datos['GradoInstruccion'])  : undefined,
          },
        })
        if (estudiante) {
          await tx.tutorEstudiante.create({
            data: { tutorId: t.id, estudianteId: estudiante.id, parentesco: parentesco as any },
          })
        }
        return t
      })

      resultado.creados.push(tutor)
      resultado.exitosas++
    } catch (e) {
      resultado.fallidas++
      resultado.errores.push({ fila, error: e instanceof Error ? e.message : 'Error desconocido' })
    }
  }

  res.status(200).json(resultado)
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

export const plantillaTutores = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const columnas = ['CI', 'Nombre', 'Apellido', 'Ocupacion', 'GradoInstruccion', 'Email', 'Telefono', 'EstudianteCI', 'Parentesco']
  const ejemplo  = { CI: '5678901', Nombre: 'Rosa', Apellido: 'Quispe Mamani', Ocupacion: 'Comerciante', GradoInstruccion: 'Secundaria', Email: 'rquispe@correo.com', Telefono: '71234567', EstudianteCI: '4567890', Parentesco: 'MADRE' }
  const buffer = await generarExcel('Plantilla', columnas, [ejemplo])
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_tutores.xlsx"')
  res.send(buffer)
})