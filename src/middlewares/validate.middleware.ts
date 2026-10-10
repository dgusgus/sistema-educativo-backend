// src/middlewares/validate.middleware.ts
import type { Request, Response, NextFunction, RequestHandler, RequestParamHandler } from 'express'
import type { ZodType } from 'zod'

interface Detalle { campo: string; mensaje: string }

function detallesDe(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>, vacio: string): Detalle[] {
  return issues.map(i => ({ campo: i.path.length ? i.path.map(String).join('.') : vacio, mensaje: i.message }))
}

// ─── validar({ body, query, params }) ────────────────────────────────────────
//
// ¿Para qué? Los esquemas zod de /src/schemas ya existen y están bien escritos, pero
// ninguna ruta los usaba: los controllers hacían `req.body as {...}` (un `as` no
// comprueba nada en ejecución) y repetían `if (!x) res.status(400)...` a mano.
// Con este middleware la validación ocurre ANTES del controller:
//   • inválido → 400 con { error: "una frase legible", detalles: [{campo, mensaje}] }
//   • válido   → req.body / req.query / req.params ya vienen limpios y convertidos
//                (números como número, sin campos desconocidos).
//
// Uso en una ruta (después de requireRol: sin permiso → 403 antes que 400):
//   router.post('/', requireRol('DOCENTE'), validar({ body: createXSchema }), createX)
//   router.get('/',  requireRol('DIRECTOR'), validar({ query: listarXSchema }), listarX)
//
// Nota Express 5: `req.query` es un getter de solo lectura (asignarlo lanza
// TypeError). Por eso se redefine como propiedad propia con defineProperty.
interface Esquemas { body?: ZodType; query?: ZodType; params?: ZodType }

export function validar(esquemas: Esquemas, mensajeGeneral?: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const detalles: Detalle[] = []

    if (esquemas.body) {
      // En Express 5, req.body es undefined si la petición no trae cuerpo.
      const r = esquemas.body.safeParse(req.body ?? {})
      if (r.success) req.body = r.data
      else detalles.push(...detallesDe(r.error.issues, '(cuerpo)'))
    }

    if (esquemas.query) {
      const r = esquemas.query.safeParse(req.query)
      if (r.success) {
        Object.defineProperty(req, 'query', { value: r.data, writable: true, configurable: true, enumerable: true })
      } else detalles.push(...detallesDe(r.error.issues, '(query)'))
    }

    if (esquemas.params) {
      const r = esquemas.params.safeParse(req.params)
      if (r.success) req.params = r.data as Request['params']
      else detalles.push(...detallesDe(r.error.issues, '(ruta)'))
    }

    if (detalles.length > 0) {
      res.status(400).json({ error: mensajeGeneral ?? `${detalles[0].campo}: ${detalles[0].mensaje}`, detalles })
      return
    }
    next()
  }
}

// Atajo retrocompatible: valida solo el cuerpo.
export function validarBody(schema: ZodType, mensajeGeneral?: string): RequestHandler {
  return validar({ body: schema }, mensajeGeneral)
}

// Para router.param('id', paramEntero): un :id que no sea entero positivo
// (por ejemplo "abc", "-1", "1e9" o "99999999999") se rechaza con 400 en vez
// de convertirse en NaN y terminar como error 500 en la base de datos.
// Actívalo UNA vez por router y cubre todas las rutas con :id:
//   router.param('id', paramEntero)
export const paramEntero: RequestParamHandler = (_req, res, next, valor, nombre) => {
  if (!/^[1-9]\d{0,9}$/.test(valor) || Number(valor) > 2_147_483_647) {
    res.status(400).json({ error: nombre === 'id' ? 'ID inválido' : `Parámetro "${nombre}" inválido` })
    return
  }
  next()
}
