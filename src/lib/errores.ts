// src/lib/errores.ts
//
// Errores "esperables" cuyo mensaje SÍ es para el usuario final. El middleware de
// errores los responde tal cual con su código HTTP; cualquier otro error se
// registra (con detalle, solo en el log) y se responde como 500 genérico.
//
// ¿Para qué las subclases? Para que un controller/servicio pueda escribir:
//
//     if (!actividad) throw new NoEncontrado('Actividad evaluativa')
//
// en vez de repetir en cada función:
//
//     res.status(404).json({ error: '...' }); return
//
// Menos código por endpoint, y el formato de la respuesta es idéntico en todos.

export class ErrorDeUsuario extends Error {
  status: number
  /** Datos extra que el frontend puede usar (p. ej. la lista de inscripciones inválidas). */
  extra?: Record<string, unknown>

  constructor(mensaje: string, status = 400, extra?: Record<string, unknown>) {
    super(mensaje)
    this.name = 'ErrorDeUsuario'
    this.status = status
    this.extra = extra
  }
}

export class NoEncontrado extends ErrorDeUsuario {
  constructor(recurso = 'Recurso') {
    super(`${recurso} no encontrado`, 404)
    this.name = 'NoEncontrado'
  }
}

export class Prohibido extends ErrorDeUsuario {
  constructor(mensaje = 'Sin permisos para esta acción') {
    super(mensaje, 403)
    this.name = 'Prohibido'
  }
}

export class Conflicto extends ErrorDeUsuario {
  constructor(mensaje: string, extra?: Record<string, unknown>) {
    super(mensaje, 409, extra)
    this.name = 'Conflicto'
  }
}
