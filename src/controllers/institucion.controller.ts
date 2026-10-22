import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { refrescarInstitucion } from '../lib/institucion.helper.js'

// Lo que se muestra SIN iniciar sesión (pantalla de login): solo datos públicos del colegio.
// No incluye teléfono ni correo.
export const getInstitucionPublica = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const i = await prisma.institucion.findUnique({ where: { id: 1 } })
  res.status(200).json(i ? {
    configurada: true,
    nombre: i.nombre,
    direccion: i.direccion,
    rue: i.rue,
    municipio: i.municipio,
    departamento: i.departamento,
    logoUrl: i.logoUrl,
  } : { configurada: false })
})

// GET /api/institucion
// Para qué: cualquier módulo que necesite los datos del colegio (boletines, reportes, encabezados).
// Incluye al director de la gestión activa (para firmas e impresos).
export const getInstitucion = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const [institucion, gestion] = await Promise.all([
    prisma.institucion.findUnique({ where: { id: 1 } }),
    prisma.gestion.findFirst({
      where: { activa: true },
      select: { director: { select: { persona: { select: { nombre: true, apellido: true } } } } },
    }),
  ])

  if (!institucion) {
    res.status(404).json({ error: 'Datos de la institución no configurados' })
    return
  }
  const p = gestion?.director?.persona
  res.status(200).json({ ...institucion, directorNombre: p ? `${p.nombre} ${p.apellido}` : null })
})

// PUT /api/institucion  (solo Director; el cuerpo ya viene validado)
// Crea los datos la primera vez y los actualiza después. Ya no hay valores por defecto:
// lo que no se envía queda vacío, así ningún dato de otro colegio se "cuela".
export const updateInstitucion = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const b = req.body as Record<string, unknown>
  const limpio = (v: unknown) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null)

  const datos = {
    nombre: String(b.nombre),
    direccion: limpio(b.direccion) as string | null,
    telefono: limpio(b.telefono) as string | null,
    email: limpio(b.email) as string | null,
    rue: limpio(b.rue) as string | null,
    logoUrl: limpio(b.logoUrl) as string | null,
    municipio: limpio(b.municipio) as string | null,
    distrito: limpio(b.distrito) as string | null,
    departamento: limpio(b.departamento) as string | null,
    dependencia: (b.dependencia ?? null) as 'FISCAL' | 'CONVENIO' | 'PRIVADO' | null,
  }

  const institucion = await prisma.institucion.upsert({
    where: { id: 1 }, update: datos, create: { id: 1, ...datos },
  })
  await refrescarInstitucion()          // los PDF usan el dato nuevo de inmediato
  res.status(200).json(institucion)
})
