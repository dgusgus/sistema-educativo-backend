// src/schemas/institucion.schema.ts
import { z } from 'zod'
import { emailOpc, enumES, telefonoOpc, textoOpc, textoReq } from './common.schema.js'

// Los datos del colegio: el nombre es lo único obligatorio (el resto se completa cuando se tiene).
// "" en un opcional vacía el campo.
export const actualizarInstitucionSchema = z.object({
  nombre:       textoReq(150),
  direccion:    textoOpc(250),
  telefono:     telefonoOpc,
  email:        emailOpc,
  rue:          textoOpc(20),
  logoUrl:      textoOpc(500),
  municipio:    textoOpc(100),
  distrito:     textoOpc(100),
  departamento: textoOpc(100),
  dependencia:  enumES(['FISCAL', 'CONVENIO', 'PRIVADO']).nullish(),
})
