// src/middlewares/upload.middleware.ts — reemplazo completo
import multer from 'multer'

const EXTENSIONES_VALIDAS = ['.xlsx', '.xls']

export const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // ✅ Se valida por EXTENSIÓN del nombre de archivo, no por mimetype
    // — el mimetype que reporta el navegador para .xlsx es inconsistente
    // entre sistemas operativos (en Windows suele llegar como
    // application/octet-stream), mientras que la extensión es confiable.
    const extension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'))
    if (!EXTENSIONES_VALIDAS.includes(extension)) {
      cb(new Error('El archivo debe ser .xlsx o .xls'))
      return
    }
    cb(null, true)
  },
}).single('archivo')