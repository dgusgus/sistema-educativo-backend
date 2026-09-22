import multer from 'multer'

// Archivo en memoria (no en disco) — se procesa y se descarta, no hace
// falta persistirlo. Límite 5MB, alcanza de sobra para un Excel de
// varios cientos de filas.
export const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const validos = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]
    cb(null, validos.includes(file.mimetype))
  },
}).single('archivo')