// src/middlewares/validate.middleware.ts
import type { Request, Response, NextFunction, RequestHandler, RequestParamHandler } from 'express'
import type { ZodType } from 'zod'

// Valida (y limpia) req.body con un esquema zod ANTES de llegar al controlador.
//  • Si es inválido → 400 con { error, detalles: [{ campo, mensaje }] }.
//    `error` es una sola frase legible (para mostrar tal cual en el frontend);
//    `detalles` trae TODOS los problemas, útil para marcar cada campo del formulario.
//  • Si es válido → req.body pasa a ser el resultado ya convertido: números como
//    número, textos sin espacios sobrantes y SIN campos desconocidos.
//
// Se coloca después de requireRol: quien no tiene permiso recibe 403 antes que 400.
export function validarBody(schema: ZodType, mensajeGeneral?: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // En Express 5, req.body es undefined si la petición no trae cuerpo.
    const resultado = schema.safeParse(req.body ?? {})

    if (!resultado.success) {
      const detalles = resultado.error.issues.map(i => ({
        campo:   i.path.length ? i.path.join('.') : '(cuerpo)',
        mensaje: i.message,
      }))
      res.status(400).json({
        error: mensajeGeneral ?? `${detalles[0].campo}: ${detalles[0].mensaje}`,
        detalles,
      })
      return
    }

    req.body = resultado.data
    next()
  }
}

// Para router.param('id', paramEntero): un :id que no sea entero positivo
// (por ejemplo "abc", "-1", "1e9" o "99999999999") se rechaza con 400 en vez
// de convertirse en NaN y terminar como error 500 en la base de datos.
export const paramEntero: RequestParamHandler = (_req, res, next, valor, nombre) => {
  if (!/^[1-9]\d{0,9}$/.test(valor) || Number(valor) > 2_147_483_647) {
    res.status(400).json({ error: nombre === 'id' ? 'ID inválido' : `Parámetro "${nombre}" inválido` })
    return
  }
  next()
}