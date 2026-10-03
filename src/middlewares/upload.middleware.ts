// src/middlewares/upload.middleware.ts
import multer from 'multer'
import path from 'node:path'
import type { Request, Response, NextFunction } from 'express'
import { ErrorDeUsuario } from '../lib/errores.js'

// Solo .xlsx. Antes también se aceptaban .xls y .csv, pero la librería no puede
// leer .xls (formato binario antiguo) y un CSV guardado desde Excel en español usa
// ";" y codificación ANSI: terminaban en error 500 o en datos mal leídos.
const MENSAJE_FORMATO =
  'Solo se aceptan archivos .xlsx (Excel). Si tu archivo es .xls o .csv, ábrelo en Excel y guárdalo como "Libro de Excel (.xlsx)".'

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    if (extension !== '.xlsx') { cb(new ErrorDeUsuario(MENSAJE_FORMATO)); return }
    cb(null, true)
  },
}).single('archivo')

// Envuelve multer para responder el error ACÁ MISMO y que el mensaje llegue
// limpio al frontend pase lo que pase con el resto de la cadena de errores.
export function uploadExcel(req: Request, res: Response, next: NextFunction): void {
  multerInstance(req, res, (err: unknown) => {
    if (err) {
      const codigo = (err as { code?: string }).code
      const mensaje =
        codigo === 'LIMIT_FILE_SIZE' ? 'El archivo supera los 5 MB. Divídelo en varios archivos.'
        : err instanceof Error ? err.message
        : 'Error al procesar el archivo'
      res.status(400).json({ error: mensaje })
      return
    }
    if (!req.file) {
      res.status(400).json({ error: 'Adjunta un archivo .xlsx (Excel)' })
      return
    }
    next()
  })
}