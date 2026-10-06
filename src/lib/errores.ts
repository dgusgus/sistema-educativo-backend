// src/lib/errores.ts
//
// Error cuyo mensaje SÍ es para el usuario final (datos mal puestos, archivo
// inválido...). El middleware de errores lo responde tal cual con su código
// HTTP; cualquier otro error se registra y se responde como 500 genérico.
export class ErrorDeUsuario extends Error {
  status: number

  constructor(mensaje: string, status = 400) {
    super(mensaje)
    this.name = 'ErrorDeUsuario'
    this.status = status
  }
}