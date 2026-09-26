// src/middlewares/upload.middleware.ts — reemplazo completo
import multer from 'multer'
import type { Request, Response, NextFunction } from 'express'

const EXTENSIONES_VALIDAS = ['.xlsx', '.xls', '.csv']

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'))
    cb(null, EXTENSIONES_VALIDAS.includes(extension))
  },
}).single('archivo')

// Envuelve multer para responder el error ACÁ MISMO en vez de depender
// de que error.middleware.ts esté bien enganchado más abajo en el
// pipeline — así el mensaje llega limpio al frontend pase lo que pase
// con el resto de la cadena de errores.
export function uploadExcel(req: Request, res: Response, next: NextFunction): void {
  multerInstance(req, res, (err: unknown) => {
    if (err) {
      const mensaje = err instanceof Error ? err.message : 'Error al procesar el archivo'
      res.status(400).json({ error: mensaje })
      return
    }
    if (!req.file) {
      res.status(400).json({ error: 'Adjunta un archivo .xlsx, .xls o .csv' })
      return
    }
    next()
  })
}