import { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// GET /api/institucion
// Para qué: cualquier módulo que necesite los datos del colegio
// (boletines, reportes, encabezados)
export const getInstitucion = async (_req: Request, res: Response): Promise<void> => {
  try {
    const institucion = await prisma.institucion.findUnique({
      where: { id: 1 },
    })

    if (!institucion) {
      res.status(404).json({ error: 'Datos de la institución no configurados' })
      return
    }

    res.status(200).json(institucion)
  } catch (error) {
    console.error('[institucion.getInstitucion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// PUT /api/institucion
// Solo el Director puede actualizar los datos del colegio
export const updateInstitucion = async (req: Request, res: Response): Promise<void> => {
  const { nombre, direccion, telefono, email, rue, logoUrl, municipio, departamento } =
    req.body as {
      nombre?:       string
      direccion?:    string
      telefono?:     string
      email?:        string
      rue?:          string
      logoUrl?:      string
      municipio?:    string
      departamento?: string
    }

  try {
    // upsert — crea si no existe, actualiza si ya existe
    const institucion = await prisma.institucion.upsert({
      where:  { id: 1 },
      update: {
        ...(nombre       !== undefined && { nombre }),
        ...(direccion    !== undefined && { direccion }),
        ...(telefono     !== undefined && { telefono }),
        ...(email        !== undefined && { email }),
        ...(rue          !== undefined && { rue }),
        ...(logoUrl      !== undefined && { logoUrl }),
        ...(municipio    !== undefined && { municipio }),
        ...(departamento !== undefined && { departamento }),
      },
      create: {
        id:          1,
        nombre:      nombre ?? 'U.E. Los Ángeles de Nazaria Ignacia',
        direccion:   direccion ?? 'Urb. Bustillos, Zona Los Ángeles, Oruro',
        telefono,
        email,
        rue:         rue ?? '81230370',
        logoUrl,
        municipio:   municipio ?? 'Oruro',
        departamento: departamento ?? 'Oruro',
      },
    })

    res.status(200).json(institucion)
  } catch (error) {
    console.error('[institucion.updateInstitucion]', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}