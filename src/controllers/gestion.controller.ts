import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { aplanarPersona } from '../lib/persona.helper.js'
import { NIVEL_TEXTO, siguienteNivelGrado } from '../lib/curso.helper.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { ErrorDeUsuario } from '../lib/errores.js'
import { z } from 'zod'
import { calcularResultadosGestion, registrarResultadosLote } from '../services/resultado-final.service.js'
import { copiarEstructura } from '../services/copiar-estructura.service.js'
import { resumenCursosPromocion, propuestaMatriculaCurso, matricularCurso } from '../services/promocion.service.js'

// Qué copiar de otra gestión (todo opcional; si no se indica, se copia).
const copiaSchema = z.object({
  origenId:      z.number().int().positive(),
  cursos:        z.boolean().optional(),
  asignaciones:  z.boolean().optional(),
  trimestres:    z.boolean().optional(),
  dimensiones:   z.boolean().optional(),
  conceptosPago: z.boolean().optional(),
})

// ─── GET /api/gestiones ───────────────────────────────────────────────────────
export const getGestiones = async (_req: Request, res: Response): Promise<void> => {
  try {
    const gestiones = await prisma.gestion.findMany({
      include: {
        director: { select: { id: true, persona: { select: { nombre: true, apellido: true } } } },
        _count:   { select: { cursos: true, inscripciones: true, trimestres: true } },
      },
      orderBy: { anio: 'desc' },
    })
    res.status(200).json(gestiones.map(g => ({
      ...g,
      director: g.director ? aplanarPersona(g.director) : null,
    })))
  } catch (error) {
    console.error('[gestion.getGestiones]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/gestiones/activa ────────────────────────────────────────────────
export const getGestionActiva = async (_req: Request, res: Response): Promise<void> => {
  try {
    const gestion = await prisma.gestion.findFirst({
      where: { activa: true },
      include: {
        director: {
          select: { id: true, persona: { select: { nombre: true, apellido: true, telefono: true, email: true } } },
        },
        cursos:     { orderBy: [{ nivel: 'asc' }, { grado: 'asc' }] },
        trimestres: { orderBy: { numero: 'asc' } },
        _count:     { select: { inscripciones: true } },
      },
    })
    // "Sin gestión activa" es un estado normal (p. ej. recién cerrada la anterior),
    // no un error: se responde 200 con null para no llenar la consola de 404.
    if (!gestion) {
      res.status(200).json(null)
      return
    }
    res.status(200).json({ ...gestion, director: gestion.director ? aplanarPersona(gestion.director) : null })
  } catch (error) {
    console.error('[gestion.getGestionActiva]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/gestiones/:id ───────────────────────────────────────────────────
export const getGestionById = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  try {
    const gestion = await prisma.gestion.findUnique({
      where: { id },
      include: {
        director:      { select: { id: true, persona: { select: { nombre: true, apellido: true } } } },
        cursos:        { orderBy: [{ nivel: 'asc' }, { grado: 'asc' }] },
        trimestres:    { orderBy: { numero: 'asc' } },
        conceptosPago: true,
        _count:        { select: { inscripciones: true, asignaciones: true } },
      },
    })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }
    res.status(200).json({ ...gestion, director: gestion.director ? aplanarPersona(gestion.director) : null })
  } catch (error) {
    console.error('[gestion.getGestionById]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/gestiones ──────────────────────────────────────────────────────
export const createGestion = async (req: Request, res: Response): Promise<void> => {
  const { anio, descripcion, fechaInicio, fechaFin, directorId, notaMinimaAprobacion, copiarDe } = req.body as {
    anio?: number
    descripcion?: string
    fechaInicio?: string
    fechaFin?: string
    directorId?: number
    notaMinimaAprobacion?: number
    copiarDe?: unknown
  }

  if (!anio) {
    res.status(400).json({ error: 'El año es obligatorio' })
    return
  }

  // Opcional: copiar la estructura (cursos, asignaciones, trimestres...) de otra gestión.
  let copia: z.infer<typeof copiaSchema> | undefined
  if (copiarDe !== undefined && copiarDe !== null) {
    const parsed = copiaSchema.safeParse(copiarDe)
    if (!parsed.success) {
      res.status(400).json({ error: 'copiarDe inválido: se espera { origenId, cursos?, asignaciones?, trimestres?, dimensiones?, conceptosPago? }' })
      return
    }
    copia = parsed.data
  }

  try {
    const existe = await prisma.gestion.findUnique({ where: { anio } })
    if (existe) {
      res.status(409).json({ error: `Ya existe una gestión para el año ${anio}` })
      return
    }

    if (directorId) {
      const director = await prisma.director.findUnique({ where: { id: directorId } })
      if (!director) {
        res.status(404).json({ error: 'Director no encontrado' })
        return
      }
      if (!director.activo) {
        res.status(400).json({ error: 'El director no está activo' })
        return
      }
    }

    // Todo en una transacción: si la copia falla no queda una gestión vacía a medias.
    const { gestion, resultadoCopia } = await prisma.$transaction(async tx => {
      const gestion = await tx.gestion.create({
        data: {
          anio,
          descripcion: descripcion ?? `Gestión Escolar ${anio}`,
          fechaInicio: fechaInicio ? new Date(fechaInicio) : undefined,
          fechaFin:    fechaFin    ? new Date(fechaFin)    : undefined,
          notaMinimaAprobacion,
          directorId,
        },
        include: {
          director: { select: { persona: { select: { nombre: true, apellido: true } } } },
        },
      })
      const resultadoCopia = copia
        ? await copiarEstructura(copia.origenId, gestion.id, copia, tx)
        : null
      return { gestion, resultadoCopia }
    }, { timeout: 30000 })

    res.status(201).json({
      ...gestion,
      director: gestion.director ? aplanarPersona(gestion.director) : null,
      copia:    resultadoCopia,
    })
  } catch (error) {
    if (error instanceof ErrorDeUsuario) {
      res.status(error.status).json({ error: error.message })
      return
    }
    console.error('[gestion.createGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/gestiones/:id ───────────────────────────────────────────────────
export const updateGestion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { descripcion, fechaInicio, fechaFin, notaMinimaAprobacion } = req.body as {
    descripcion?: string
    fechaInicio?: string
    fechaFin?: string
    notaMinimaAprobacion?: number
  }

  try {
    const existe = await prisma.gestion.findUnique({ where: { id } })
    if (!existe) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    const gestion = await prisma.gestion.update({
      where: { id },
      data: {
        ...(descripcion           !== undefined && { descripcion }),
        ...(fechaInicio           !== undefined && { fechaInicio: new Date(fechaInicio) }),
        ...(fechaFin              !== undefined && { fechaFin:    new Date(fechaFin) }),
        ...(notaMinimaAprobacion  !== undefined && { notaMinimaAprobacion }),
      },
    })
    res.status(200).json(gestion)
  } catch (error) {
    console.error('[gestion.updateGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/gestiones/:id/director ─────────────────────────────────────────
export const asignarDirector = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)
  const { directorId } = req.body as { directorId?: number }

  if (!directorId) {
    res.status(400).json({ error: 'directorId es obligatorio' })
    return
  }

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    const director = await prisma.director.findUnique({
      where: { id: directorId },
      include: { persona: { select: { nombre: true, apellido: true } } },
    })
    if (!director) {
      res.status(404).json({ error: 'Director no encontrado' })
      return
    }
    if (!director.activo) {
      res.status(400).json({ error: 'El director no está activo' })
      return
    }

    const actualizada = await prisma.gestion.update({
      where: { id },
      data:  { directorId },
      include: { director: { select: { id: true, persona: { select: { nombre: true, apellido: true } } } } },
    })

    res.status(200).json({
      gestion: { ...actualizada, director: aplanarPersona(actualizada.director!) },
      mensaje: `${director.persona.nombre} ${director.persona.apellido} asignado como director de la gestión ${gestion.anio}`,
    })
  } catch (error) {
    console.error('[gestion.asignarDirector]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── PUT /api/gestiones/:id/activar ──────────────────────────────────────────
export const activarGestion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    await prisma.gestion.updateMany({
      where: { id: { not: id } },
      data:  { activa: false },
    })

    const actualizada = await prisma.gestion.update({
      where: { id },
      data:  { activa: true },
      include: { director: { select: { persona: { select: { nombre: true, apellido: true } } } } },
    })

    res.status(200).json({
      message: `Gestión ${actualizada.anio} activada correctamente`,
      gestion: { ...actualizada, director: actualizada.director ? aplanarPersona(actualizada.director) : null },
    })
  } catch (error) {
    console.error('[gestion.activarGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── POST /api/gestiones/:id/cerrar ──────────────────────────────────────────
export const cerrarGestion = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    if (!gestion.activa) {
      res.status(400).json({ error: 'Esta gestión ya no está activa' })
      return
    }

    const trimestresAbiertos = await prisma.trimestre.findMany({
      where: { gestionId: id, cerrado: false },
    })
    if (trimestresAbiertos.length > 0) {
      res.status(400).json({
        error: 'No se puede cerrar la gestión — hay trimestres sin cerrar',
        trimestresAbiertos: trimestresAbiertos.map(t => t.nombre),
      })
      return
    }

    const sinResultado = await prisma.inscripcion.findMany({
      where: { gestionId: id, estadoInscripcion: 'ACTIVA', resultado: 'PENDIENTE' },
      include: { estudiante: { select: { persona: { select: { nombre: true, apellido: true } } } } },
    })
    if (sinResultado.length > 0) {
      res.status(400).json({
        error: `${sinResultado.length} estudiantes activos sin resultado final registrado`,
        sugerencia: 'Registra PROMOVIDO o REPROBADO con POST /inscripciones/:id/resultado',
        estudiantesPendientes: sinResultado.map(
          i => `${i.estudiante.persona.nombre} ${i.estudiante.persona.apellido}`
        ),
      })
      return
    }

    await prisma.inscripcion.updateMany({
      where: { gestionId: id, estadoInscripcion: 'ACTIVA' },
      data:  { estadoInscripcion: 'CONCLUIDA' },
    })

    const cerrada = await prisma.gestion.update({ where: { id }, data: { activa: false } })

    res.status(200).json({
      message: `Gestión ${cerrada.anio} cerrada correctamente`,
      gestion: cerrada,
      siguientePaso: 'Crea la siguiente gestión copiando la estructura de esta (POST /gestiones con copiarDe) y usa Promoción para inscribir a los estudiantes en el nuevo año',
    })
  } catch (error) {
    console.error('[gestion.cerrarGestion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/gestiones/:id/propuesta-inscripciones ──────────────────────────
// Reescrito para v6: antes comparaba insc.curso.nivel contra una lista
// de strings tipo "Primero Secundaria"..."Sexto Secundaria" — eso ya no
// existe. Ahora Curso.nivel es PRIMARIA|SECUNDARIA y Curso.grado es 1..6
// por separado, así que la progresión se calcula con
// siguienteNivelGrado() (6to Primaria → 1ro Secundaria, 6to Secundaria
// → egresado).
export const getPropuestaInscripciones = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id)

  try {
    const gestion = await prisma.gestion.findUnique({ where: { id } })
    if (!gestion) {
      res.status(404).json({ error: 'Gestión no encontrada' })
      return
    }

    const inscripciones = await prisma.inscripcion.findMany({
      where: { gestionId: id },
      include: {
        estudiante: { select: { id: true, persona: { select: { nombre: true, apellido: true, ci: true } } } },
        curso:      { select: { nivel: true, grado: true, paralelo: true } },
      },
      orderBy: [
        { curso: { nivel: 'asc' } },
        { curso: { grado: 'asc' } },
        { estudiante: { persona: { apellido: 'asc' } } },
      ],
    })

    const propuesta = inscripciones.map(insc => {
      let cursoSugerido: string | null = null
      let accion = ''

      if (insc.estadoInscripcion === 'RETIRADA' || insc.estadoInscripcion === 'TRANSFERIDA') {
        accion = 'NO_CONTINUA'
      } else if (insc.resultado === 'REPROBADO') {
        cursoSugerido = `${insc.curso.grado}° ${NIVEL_TEXTO[insc.curso.nivel]} (repite, mismo paralelo sugerido: "${insc.curso.paralelo}")`
        accion = 'REPETIR_CURSO'
      } else if (insc.resultado === 'PROMOVIDO') {
        const siguiente = siguienteNivelGrado(insc.curso.nivel, insc.curso.grado)
        if (!siguiente) {
          accion = 'EGRESADO'
        } else {
          cursoSugerido = `${siguiente.grado}° ${NIVEL_TEXTO[siguiente.nivel]}`
          accion = 'PROMOVER'
        }
      } else {
        accion = 'SIN_RESULTADO'
      }

      return {
        estudianteId: insc.estudiante.id,
        estudiante:   `${insc.estudiante.persona.nombre} ${insc.estudiante.persona.apellido}`,
        ci:           insc.estudiante.persona.ci,
        cursoActual:  `${insc.curso.grado}° ${NIVEL_TEXTO[insc.curso.nivel]} "${insc.curso.paralelo}"`,
        estado:       insc.estadoInscripcion,
        resultado:    insc.resultado,
        accion,
        cursoSugerido,
      }
    })

    const resumen = {
      promover:  propuesta.filter(p => p.accion === 'PROMOVER').length,
      repetir:   propuesta.filter(p => p.accion === 'REPETIR_CURSO').length,
      egresados: propuesta.filter(p => p.accion === 'EGRESADO').length,
      noContinua: propuesta.filter(p => p.accion === 'NO_CONTINUA').length,
      revisarManualmente: propuesta.filter(p => p.accion === 'SIN_RESULTADO').length,
    }

    res.status(200).json({
      gestion: { id: gestion.id, anio: gestion.anio },
      resumen,
      propuesta,
    })
  } catch (error) {
    console.error('[gestion.getPropuestaInscripciones]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ─── GET /api/gestiones/:id/propuesta-resultados ─────────────────────────────
// Paso 1 de Promoción: calcula, SIN escribir nada, el resultado del año de
// cada estudiante a partir de los promedios finales de sus materias
// (reprueba quien tenga alguna materia bajo la nota mínima de la gestión).
export const getPropuestaResultados = asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw new ErrorDeUsuario('id de gestión inválido')

  // ?cursoId=N limita el cálculo a un curso (Promoción por curso).
  const cursoId = enteroOpcional(req.query.cursoId, 'cursoId')
  const calculo = await calcularResultadosGestion(id, { cursoId })
  res.status(200).json(calculo)
})

// ─── POST /api/gestiones/:id/resultados ──────────────────────────────────────
// Registra en lote el resultado del año. El navegador manda SOLO los ids de
// inscripción: el resultado lo vuelve a calcular el servidor, así que no se
// puede promover a quien reprobó ni reprobar a quien aprobó.
const resultadosLoteSchema = z.object({
  inscripcionIds: z.array(z.number().int().positive()).min(1, 'Selecciona al menos un estudiante').max(2000),
  // Promoción por curso: si se indica, solo se aceptan estudiantes de ese curso.
  cursoId:        z.number().int().positive().optional(),
})

export const registrarResultados = asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw new ErrorDeUsuario('id de gestión inválido')

  const { inscripcionIds, cursoId } = resultadosLoteSchema.parse(req.body)
  const resultado = await registrarResultadosLote(id, inscripcionIds, cursoId)
  res.status(200).json(resultado)
})

// ─── POST /api/gestiones/:id/copiar-estructura ───────────────────────────────
// Copia cursos, asignaciones, trimestres, dimensiones y conceptos de pago de
// otra gestión (origenId) a ESTA (:id). Aditivo: no pisa ni borra lo existente.
export const copiarEstructuraGestion = asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw new ErrorDeUsuario('id de gestión inválido')

  const { origenId, ...opciones } = copiaSchema.parse(req.body)
  const resultado = await prisma.$transaction(tx => copiarEstructura(origenId, id, opciones, tx), { timeout: 30000 })
  res.status(200).json(resultado)
})

// ─── Promoción por curso ─────────────────────────────────────────────────────
// Lee un entero opcional de la query (?cursoId=3). Si viene y no es válido → 400.
function enteroOpcional(valor: unknown, nombre: string): number | undefined {
  if (valor === undefined || valor === '') return undefined
  const n = Number(valor)
  if (!Number.isInteger(n) || n <= 0) throw new ErrorDeUsuario(`${nombre} inválido`)
  return n
}

function enteroRequerido(valor: unknown, nombre: string): number {
  const n = enteroOpcional(valor, nombre)
  if (n === undefined) throw new ErrorDeUsuario(`${nombre} es obligatorio`)
  return n
}

// GET /api/gestiones/:id/promocion/cursos?destinoId=N
// Tablero: un renglón por curso de la gestión :id con cuántos estudiantes tiene,
// cuántos ya tienen resultado y cuántos ya fueron matriculados en la gestión destino.
export const getCursosPromocion = asyncHandler(async (req, res): Promise<void> => {
  const id = enteroRequerido(req.params.id, 'id de gestión')
  const destinoId = enteroOpcional(req.query.destinoId, 'destinoId')
  res.status(200).json(await resumenCursosPromocion(id, destinoId))
})

// GET /api/gestiones/:id/promocion/matricula?cursoId=N&destinoId=M
// Paso 2 de UN curso: sus estudiantes por grupo (promovidos, repiten, egresan...) y
// los cursos de la gestión destino a los que pueden ir, con uno sugerido.
export const getPropuestaMatricula = asyncHandler(async (req, res): Promise<void> => {
  const id = enteroRequerido(req.params.id, 'id de gestión')
  const cursoId = enteroRequerido(req.query.cursoId, 'cursoId')
  const destinoId = enteroRequerido(req.query.destinoId, 'destinoId')
  res.status(200).json(await propuestaMatriculaCurso(id, cursoId, destinoId))
})

// POST /api/gestiones/:id/promocion/matricular
// Matricula en lote a estudiantes de UN curso. El servidor valida todo (grado
// correcto, sin doble matrícula, historial) y reporta uno por uno los que fallan.
const matricularSchema = z.object({
  destinoId:         z.number().int().positive(),
  cursoOrigenId:     z.number().int().positive(),
  cursoPromovidosId: z.number().int().positive().optional(),
  cursoRepitenId:    z.number().int().positive().optional(),
  inscripcionIds:    z.array(z.number().int().positive()).min(1, 'Selecciona al menos un estudiante').max(500),
})

export const matricularPromocion = asyncHandler(async (req, res): Promise<void> => {
  const id = enteroRequerido(req.params.id, 'id de gestión')
  const pedido = matricularSchema.parse(req.body)
  const resultado = await prisma.$transaction(tx => matricularCurso(id, pedido, tx), { timeout: 30000 })
  res.status(200).json(resultado)
})