-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('DIRECTOR', 'SECRETARIA', 'DOCENTE', 'ESTUDIANTE', 'TUTOR');

-- CreateEnum
CREATE TYPE "EstadoInscripcion" AS ENUM ('ACTIVA', 'RETIRADA', 'TRANSFERIDA', 'CONCLUIDA');

-- CreateEnum
CREATE TYPE "Resultado" AS ENUM ('PENDIENTE', 'PROMOVIDO', 'REPROBADO');

-- CreateEnum
CREATE TYPE "DiaSemana" AS ENUM ('LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO');

-- CreateEnum
CREATE TYPE "EstadoAsistencia" AS ENUM ('PRESENTE', 'AUSENTE', 'RETRASO', 'JUSTIFICADO');

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'QR');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PAGADO', 'PARCIAL', 'PENDIENTE', 'ANULADO');

-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('MASCULINO', 'FEMENINO');

-- CreateEnum
CREATE TYPE "Nivel" AS ENUM ('PRIMARIA', 'SECUNDARIA');

-- CreateEnum
CREATE TYPE "Turno" AS ENUM ('MANANA', 'TARDE', 'NOCHE');

-- CreateEnum
CREATE TYPE "Parentesco" AS ENUM ('PADRE', 'MADRE', 'ABUELO', 'ABUELA', 'TIO', 'TIA', 'HERMANO', 'HERMANA', 'TUTOR_LEGAL', 'OTRO');

-- CreateEnum
CREATE TYPE "Dependencia" AS ENUM ('FISCAL', 'CONVENIO', 'PRIVADO');

-- CreateEnum
CREATE TYPE "TipoValorConfig" AS ENUM ('TEXTO', 'ENTERO', 'DECIMAL', 'BOOLEANO', 'JSON');

-- CreateTable
CREATE TABLE "Configuracion" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "tipo" "TipoValorConfig" NOT NULL DEFAULT 'TEXTO',
    "descripcion" TEXT,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configuracion_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "Institucion" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "rue" TEXT,
    "logoUrl" TEXT,
    "municipio" TEXT,
    "departamento" TEXT,
    "dependencia" "Dependencia",
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institucion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" "Rol"[],
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoAcceso" TIMESTAMP(3),
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" SERIAL NOT NULL,
    "ci" TEXT,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "sexo" "Sexo",
    "fechaNacimiento" DATE,
    "direccion" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "nacionalidad" TEXT DEFAULT 'Boliviana',
    "fotoUrl" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Director" (
    "id" SERIAL NOT NULL,
    "personaId" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "Director_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Secretaria" (
    "id" SERIAL NOT NULL,
    "personaId" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "Secretaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Docente" (
    "id" SERIAL NOT NULL,
    "personaId" INTEGER NOT NULL,
    "especialidad" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "usuarioId" INTEGER,

    CONSTRAINT "Docente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estudiante" (
    "id" SERIAL NOT NULL,
    "rude" TEXT,
    "personaId" INTEGER NOT NULL,
    "lugarNacimiento" TEXT,
    "idiomaMaterno" TEXT DEFAULT 'Castellano',
    "idiomaHablado" TEXT DEFAULT 'Castellano',
    "discapacidad" BOOLEAN NOT NULL DEFAULT false,
    "tipoDiscapacidad" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "usuarioId" INTEGER,

    CONSTRAINT "Estudiante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tutor" (
    "id" SERIAL NOT NULL,
    "personaId" INTEGER NOT NULL,
    "ocupacion" TEXT,
    "gradoInstruccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "usuarioId" INTEGER,

    CONSTRAINT "Tutor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorEstudiante" (
    "id" SERIAL NOT NULL,
    "tutorId" INTEGER NOT NULL,
    "estudianteId" INTEGER NOT NULL,
    "parentesco" "Parentesco" NOT NULL,
    "esTutorPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "esApoderado" BOOLEAN NOT NULL DEFAULT false,
    "viveConEstudiante" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorEstudiante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gestion" (
    "id" SERIAL NOT NULL,
    "anio" INTEGER NOT NULL,
    "descripcion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "fechaInicio" DATE,
    "fechaFin" DATE,
    "notaMinimaAprobacion" DECIMAL(5,2) NOT NULL DEFAULT 51,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "directorId" INTEGER,

    CONSTRAINT "Gestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Curso" (
    "id" SERIAL NOT NULL,
    "nivel" "Nivel" NOT NULL,
    "grado" INTEGER NOT NULL,
    "paralelo" TEXT NOT NULL,
    "turno" "Turno" NOT NULL DEFAULT 'MANANA',
    "capacidad" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "gestionId" INTEGER NOT NULL,
    "tutorDocenteId" INTEGER,

    CONSTRAINT "Curso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampoSaber" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CampoSaber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Materia" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "horasSemanales" INTEGER NOT NULL DEFAULT 4,
    "campoSaberId" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Materia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trimestre" (
    "id" SERIAL NOT NULL,
    "numero" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "fechaInicio" DATE NOT NULL,
    "fechaFin" DATE NOT NULL,
    "cerrado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "gestionId" INTEGER NOT NULL,

    CONSTRAINT "Trimestre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inscripcion" (
    "id" SERIAL NOT NULL,
    "fechaInscripcion" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estadoInscripcion" "EstadoInscripcion" NOT NULL DEFAULT 'ACTIVA',
    "fechaRetiro" DATE,
    "resultado" "Resultado" NOT NULL DEFAULT 'PENDIENTE',
    "observaciones" TEXT,
    "procedencia" TEXT,
    "gestionId" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "estudianteId" INTEGER NOT NULL,
    "cursoId" INTEGER NOT NULL,

    CONSTRAINT "Inscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocenteMateriaCurso" (
    "id" SERIAL NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "docenteId" INTEGER NOT NULL,
    "materiaId" INTEGER NOT NULL,
    "cursoId" INTEGER NOT NULL,
    "gestionId" INTEGER NOT NULL,

    CONSTRAINT "DocenteMateriaCurso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Horario" (
    "id" SERIAL NOT NULL,
    "diaSemana" "DiaSemana" NOT NULL,
    "horaInicio" TIME NOT NULL,
    "horaFin" TIME NOT NULL,
    "aula" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "docenteMateriaCursoId" INTEGER NOT NULL,

    CONSTRAINT "Horario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asistencia" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "EstadoAsistencia" NOT NULL,
    "justificacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "inscripcionId" INTEGER NOT NULL,
    "docenteMateriaCursoId" INTEGER NOT NULL,
    "trimestreId" INTEGER NOT NULL,

    CONSTRAINT "Asistencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumenAsistencia" (
    "id" SERIAL NOT NULL,
    "totalClases" INTEGER NOT NULL DEFAULT 0,
    "totalPresente" INTEGER NOT NULL DEFAULT 0,
    "totalAusente" INTEGER NOT NULL DEFAULT 0,
    "totalRetraso" INTEGER NOT NULL DEFAULT 0,
    "totalJustificado" INTEGER NOT NULL DEFAULT 0,
    "porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "inscripcionId" INTEGER NOT NULL,
    "docenteMateriaCursoId" INTEGER NOT NULL,
    "trimestreId" INTEGER NOT NULL,

    CONSTRAINT "ResumenAsistencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DimensionEvaluacion" (
    "id" SERIAL NOT NULL,
    "gestionId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "puntajeMaximo" DECIMAL(5,2) NOT NULL,
    "pesoEnPromedio" DECIMAL(4,3) NOT NULL DEFAULT 1,
    "orden" INTEGER NOT NULL,
    "esAutoevaluada" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DimensionEvaluacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActividadEvaluativa" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "puntajeMaximo" DECIMAL(5,2) NOT NULL,
    "peso" DECIMAL(4,3) NOT NULL DEFAULT 1,
    "esRecuperatorio" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "docenteMateriaCursoId" INTEGER NOT NULL,
    "trimestreId" INTEGER NOT NULL,
    "dimensionId" INTEGER NOT NULL,

    CONSTRAINT "ActividadEvaluativa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotaActividad" (
    "id" SERIAL NOT NULL,
    "actividadEvaluativaId" INTEGER NOT NULL,
    "inscripcionId" INTEGER NOT NULL,
    "nota" DECIMAL(5,2) NOT NULL,
    "observacion" TEXT,
    "registradoPorId" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotaActividad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitacoraClase" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tema" TEXT NOT NULL,
    "descripcion" TEXT,
    "tareaAsignada" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "docenteMateriaCursoId" INTEGER NOT NULL,
    "trimestreId" INTEGER,

    CONSTRAINT "BitacoraClase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calificacion" (
    "id" SERIAL NOT NULL,
    "promedioTrimestral" DECIMAL(5,2),
    "registradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "inscripcionId" INTEGER NOT NULL,
    "docenteMateriaCursoId" INTEGER NOT NULL,
    "trimestreId" INTEGER NOT NULL,

    CONSTRAINT "Calificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalificacionDimension" (
    "id" SERIAL NOT NULL,
    "calificacionId" INTEGER NOT NULL,
    "dimensionId" INTEGER NOT NULL,
    "promedio" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "CalificacionDimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistorialCalificacion" (
    "id" SERIAL NOT NULL,
    "promedioAnterior" DECIMAL(5,2),
    "promedioNuevo" DECIMAL(5,2) NOT NULL,
    "motivo" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "calificacionId" INTEGER NOT NULL,

    CONSTRAINT "HistorialCalificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromedioFinal" (
    "id" SERIAL NOT NULL,
    "promedioFinal" DECIMAL(5,2) NOT NULL,
    "resultado" "Resultado" NOT NULL DEFAULT 'PENDIENTE',
    "calculadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "inscripcionId" INTEGER NOT NULL,
    "docenteMateriaCursoId" INTEGER NOT NULL,

    CONSTRAINT "PromedioFinal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptoPago" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "monto" DECIMAL(10,2) NOT NULL,
    "obligatorio" BOOLEAN NOT NULL DEFAULT true,
    "fechaVencimiento" DATE,
    "aplicarMora" BOOLEAN NOT NULL DEFAULT false,
    "porcentajeMora" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "gestionId" INTEGER NOT NULL,

    CONSTRAINT "ConceptoPago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" SERIAL NOT NULL,
    "montoOriginal" DECIMAL(10,2) NOT NULL,
    "descuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "montoPagado" DECIMAL(10,2) NOT NULL,
    "fechaPago" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodoPago" "MetodoPago" NOT NULL DEFAULT 'EFECTIVO',
    "estado" "EstadoPago" NOT NULL DEFAULT 'PAGADO',
    "numeroRecibo" TEXT,
    "serieRecibo" TEXT DEFAULT 'A',
    "observaciones" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "inscripcionId" INTEGER NOT NULL,
    "conceptoPagoId" INTEGER NOT NULL,
    "registradoPorId" INTEGER,

    CONSTRAINT "Pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_username_key" ON "Usuario"("username");

-- CreateIndex
CREATE INDEX "Usuario_activo_idx" ON "Usuario"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_ci_key" ON "Persona"("ci");

-- CreateIndex
CREATE INDEX "Persona_nombre_apellido_idx" ON "Persona"("nombre", "apellido");

-- CreateIndex
CREATE UNIQUE INDEX "Director_personaId_key" ON "Director"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "Director_usuarioId_key" ON "Director"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Secretaria_personaId_key" ON "Secretaria"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "Secretaria_usuarioId_key" ON "Secretaria"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Docente_personaId_key" ON "Docente"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "Docente_usuarioId_key" ON "Docente"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Estudiante_rude_key" ON "Estudiante"("rude");

-- CreateIndex
CREATE UNIQUE INDEX "Estudiante_personaId_key" ON "Estudiante"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "Estudiante_usuarioId_key" ON "Estudiante"("usuarioId");

-- CreateIndex
CREATE INDEX "Estudiante_activo_idx" ON "Estudiante"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_personaId_key" ON "Tutor"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_usuarioId_key" ON "Tutor"("usuarioId");

-- CreateIndex
CREATE INDEX "TutorEstudiante_estudianteId_idx" ON "TutorEstudiante"("estudianteId");

-- CreateIndex
CREATE UNIQUE INDEX "TutorEstudiante_tutorId_estudianteId_key" ON "TutorEstudiante"("tutorId", "estudianteId");

-- CreateIndex
CREATE UNIQUE INDEX "Gestion_anio_key" ON "Gestion"("anio");

-- CreateIndex
CREATE INDEX "Gestion_activa_idx" ON "Gestion"("activa");

-- CreateIndex
CREATE INDEX "Curso_gestionId_idx" ON "Curso"("gestionId");

-- CreateIndex
CREATE INDEX "Curso_activo_idx" ON "Curso"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "Curso_nivel_grado_paralelo_turno_gestionId_key" ON "Curso"("nivel", "grado", "paralelo", "turno", "gestionId");

-- CreateIndex
CREATE UNIQUE INDEX "Curso_id_gestionId_key" ON "Curso"("id", "gestionId");

-- CreateIndex
CREATE UNIQUE INDEX "CampoSaber_nombre_key" ON "CampoSaber"("nombre");

-- CreateIndex
CREATE INDEX "CampoSaber_activo_idx" ON "CampoSaber"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "Materia_codigo_key" ON "Materia"("codigo");

-- CreateIndex
CREATE INDEX "Materia_campoSaberId_idx" ON "Materia"("campoSaberId");

-- CreateIndex
CREATE INDEX "Materia_activo_idx" ON "Materia"("activo");

-- CreateIndex
CREATE INDEX "Trimestre_gestionId_idx" ON "Trimestre"("gestionId");

-- CreateIndex
CREATE UNIQUE INDEX "Trimestre_numero_gestionId_key" ON "Trimestre"("numero", "gestionId");

-- CreateIndex
CREATE UNIQUE INDEX "Trimestre_id_gestionId_key" ON "Trimestre"("id", "gestionId");

-- CreateIndex
CREATE INDEX "Inscripcion_cursoId_idx" ON "Inscripcion"("cursoId");

-- CreateIndex
CREATE INDEX "Inscripcion_estadoInscripcion_idx" ON "Inscripcion"("estadoInscripcion");

-- CreateIndex
CREATE UNIQUE INDEX "Inscripcion_estudianteId_gestionId_key" ON "Inscripcion"("estudianteId", "gestionId");

-- CreateIndex
CREATE UNIQUE INDEX "Inscripcion_id_gestionId_key" ON "Inscripcion"("id", "gestionId");

-- CreateIndex
CREATE INDEX "DocenteMateriaCurso_docenteId_idx" ON "DocenteMateriaCurso"("docenteId");

-- CreateIndex
CREATE INDEX "DocenteMateriaCurso_cursoId_idx" ON "DocenteMateriaCurso"("cursoId");

-- CreateIndex
CREATE INDEX "DocenteMateriaCurso_materiaId_idx" ON "DocenteMateriaCurso"("materiaId");

-- CreateIndex
CREATE UNIQUE INDEX "DocenteMateriaCurso_docenteId_materiaId_cursoId_gestionId_key" ON "DocenteMateriaCurso"("docenteId", "materiaId", "cursoId", "gestionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocenteMateriaCurso_id_gestionId_key" ON "DocenteMateriaCurso"("id", "gestionId");

-- CreateIndex
CREATE INDEX "Horario_docenteMateriaCursoId_idx" ON "Horario"("docenteMateriaCursoId");

-- CreateIndex
CREATE UNIQUE INDEX "Horario_docenteMateriaCursoId_diaSemana_horaInicio_key" ON "Horario"("docenteMateriaCursoId", "diaSemana", "horaInicio");

-- CreateIndex
CREATE INDEX "Asistencia_fecha_idx" ON "Asistencia"("fecha");

-- CreateIndex
CREATE INDEX "Asistencia_inscripcionId_idx" ON "Asistencia"("inscripcionId");

-- CreateIndex
CREATE INDEX "Asistencia_estado_idx" ON "Asistencia"("estado");

-- CreateIndex
CREATE INDEX "Asistencia_trimestreId_idx" ON "Asistencia"("trimestreId");

-- CreateIndex
CREATE UNIQUE INDEX "Asistencia_inscripcionId_docenteMateriaCursoId_fecha_key" ON "Asistencia"("inscripcionId", "docenteMateriaCursoId", "fecha");

-- CreateIndex
CREATE INDEX "ResumenAsistencia_trimestreId_idx" ON "ResumenAsistencia"("trimestreId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumenAsistencia_inscripcionId_docenteMateriaCursoId_trime_key" ON "ResumenAsistencia"("inscripcionId", "docenteMateriaCursoId", "trimestreId");

-- CreateIndex
CREATE INDEX "DimensionEvaluacion_gestionId_idx" ON "DimensionEvaluacion"("gestionId");

-- CreateIndex
CREATE UNIQUE INDEX "DimensionEvaluacion_gestionId_nombre_key" ON "DimensionEvaluacion"("gestionId", "nombre");

-- CreateIndex
CREATE INDEX "ActividadEvaluativa_docenteMateriaCursoId_trimestreId_idx" ON "ActividadEvaluativa"("docenteMateriaCursoId", "trimestreId");

-- CreateIndex
CREATE INDEX "ActividadEvaluativa_dimensionId_idx" ON "ActividadEvaluativa"("dimensionId");

-- CreateIndex
CREATE INDEX "ActividadEvaluativa_activo_idx" ON "ActividadEvaluativa"("activo");

-- CreateIndex
CREATE INDEX "NotaActividad_inscripcionId_idx" ON "NotaActividad"("inscripcionId");

-- CreateIndex
CREATE INDEX "NotaActividad_actividadEvaluativaId_idx" ON "NotaActividad"("actividadEvaluativaId");

-- CreateIndex
CREATE UNIQUE INDEX "NotaActividad_actividadEvaluativaId_inscripcionId_key" ON "NotaActividad"("actividadEvaluativaId", "inscripcionId");

-- CreateIndex
CREATE INDEX "BitacoraClase_docenteMateriaCursoId_fecha_idx" ON "BitacoraClase"("docenteMateriaCursoId", "fecha");

-- CreateIndex
CREATE INDEX "BitacoraClase_trimestreId_idx" ON "BitacoraClase"("trimestreId");

-- CreateIndex
CREATE INDEX "Calificacion_trimestreId_idx" ON "Calificacion"("trimestreId");

-- CreateIndex
CREATE INDEX "Calificacion_inscripcionId_idx" ON "Calificacion"("inscripcionId");

-- CreateIndex
CREATE UNIQUE INDEX "Calificacion_inscripcionId_docenteMateriaCursoId_trimestreI_key" ON "Calificacion"("inscripcionId", "docenteMateriaCursoId", "trimestreId");

-- CreateIndex
CREATE INDEX "CalificacionDimension_dimensionId_idx" ON "CalificacionDimension"("dimensionId");

-- CreateIndex
CREATE UNIQUE INDEX "CalificacionDimension_calificacionId_dimensionId_key" ON "CalificacionDimension"("calificacionId", "dimensionId");

-- CreateIndex
CREATE INDEX "HistorialCalificacion_calificacionId_idx" ON "HistorialCalificacion"("calificacionId");

-- CreateIndex
CREATE INDEX "HistorialCalificacion_usuarioId_idx" ON "HistorialCalificacion"("usuarioId");

-- CreateIndex
CREATE INDEX "PromedioFinal_inscripcionId_idx" ON "PromedioFinal"("inscripcionId");

-- CreateIndex
CREATE UNIQUE INDEX "PromedioFinal_inscripcionId_docenteMateriaCursoId_key" ON "PromedioFinal"("inscripcionId", "docenteMateriaCursoId");

-- CreateIndex
CREATE INDEX "ConceptoPago_gestionId_idx" ON "ConceptoPago"("gestionId");

-- CreateIndex
CREATE INDEX "ConceptoPago_activo_idx" ON "ConceptoPago"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_numeroRecibo_key" ON "Pago"("numeroRecibo");

-- CreateIndex
CREATE INDEX "Pago_inscripcionId_idx" ON "Pago"("inscripcionId");

-- CreateIndex
CREATE INDEX "Pago_conceptoPagoId_idx" ON "Pago"("conceptoPagoId");

-- CreateIndex
CREATE INDEX "Pago_estado_idx" ON "Pago"("estado");

-- CreateIndex
CREATE INDEX "Pago_fechaPago_idx" ON "Pago"("fechaPago");

-- AddForeignKey
ALTER TABLE "Director" ADD CONSTRAINT "Director_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Director" ADD CONSTRAINT "Director_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Secretaria" ADD CONSTRAINT "Secretaria_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Secretaria" ADD CONSTRAINT "Secretaria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docente" ADD CONSTRAINT "Docente_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docente" ADD CONSTRAINT "Docente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estudiante" ADD CONSTRAINT "Estudiante_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estudiante" ADD CONSTRAINT "Estudiante_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tutor" ADD CONSTRAINT "Tutor_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tutor" ADD CONSTRAINT "Tutor_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorEstudiante" ADD CONSTRAINT "TutorEstudiante_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorEstudiante" ADD CONSTRAINT "TutorEstudiante_estudianteId_fkey" FOREIGN KEY ("estudianteId") REFERENCES "Estudiante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gestion" ADD CONSTRAINT "Gestion_directorId_fkey" FOREIGN KEY ("directorId") REFERENCES "Director"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Curso" ADD CONSTRAINT "Curso_gestionId_fkey" FOREIGN KEY ("gestionId") REFERENCES "Gestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Curso" ADD CONSTRAINT "Curso_tutorDocenteId_fkey" FOREIGN KEY ("tutorDocenteId") REFERENCES "Docente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Materia" ADD CONSTRAINT "Materia_campoSaberId_fkey" FOREIGN KEY ("campoSaberId") REFERENCES "CampoSaber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trimestre" ADD CONSTRAINT "Trimestre_gestionId_fkey" FOREIGN KEY ("gestionId") REFERENCES "Gestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inscripcion" ADD CONSTRAINT "Inscripcion_estudianteId_fkey" FOREIGN KEY ("estudianteId") REFERENCES "Estudiante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inscripcion" ADD CONSTRAINT "Inscripcion_cursoId_gestionId_fkey" FOREIGN KEY ("cursoId", "gestionId") REFERENCES "Curso"("id", "gestionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inscripcion" ADD CONSTRAINT "Inscripcion_gestionId_fkey" FOREIGN KEY ("gestionId") REFERENCES "Gestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocenteMateriaCurso" ADD CONSTRAINT "DocenteMateriaCurso_docenteId_fkey" FOREIGN KEY ("docenteId") REFERENCES "Docente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocenteMateriaCurso" ADD CONSTRAINT "DocenteMateriaCurso_materiaId_fkey" FOREIGN KEY ("materiaId") REFERENCES "Materia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocenteMateriaCurso" ADD CONSTRAINT "DocenteMateriaCurso_cursoId_gestionId_fkey" FOREIGN KEY ("cursoId", "gestionId") REFERENCES "Curso"("id", "gestionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocenteMateriaCurso" ADD CONSTRAINT "DocenteMateriaCurso_gestionId_fkey" FOREIGN KEY ("gestionId") REFERENCES "Gestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Horario" ADD CONSTRAINT "Horario_docenteMateriaCursoId_fkey" FOREIGN KEY ("docenteMateriaCursoId") REFERENCES "DocenteMateriaCurso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asistencia" ADD CONSTRAINT "Asistencia_inscripcionId_fkey" FOREIGN KEY ("inscripcionId") REFERENCES "Inscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asistencia" ADD CONSTRAINT "Asistencia_docenteMateriaCursoId_fkey" FOREIGN KEY ("docenteMateriaCursoId") REFERENCES "DocenteMateriaCurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asistencia" ADD CONSTRAINT "Asistencia_trimestreId_fkey" FOREIGN KEY ("trimestreId") REFERENCES "Trimestre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumenAsistencia" ADD CONSTRAINT "ResumenAsistencia_inscripcionId_fkey" FOREIGN KEY ("inscripcionId") REFERENCES "Inscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumenAsistencia" ADD CONSTRAINT "ResumenAsistencia_docenteMateriaCursoId_fkey" FOREIGN KEY ("docenteMateriaCursoId") REFERENCES "DocenteMateriaCurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumenAsistencia" ADD CONSTRAINT "ResumenAsistencia_trimestreId_fkey" FOREIGN KEY ("trimestreId") REFERENCES "Trimestre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DimensionEvaluacion" ADD CONSTRAINT "DimensionEvaluacion_gestionId_fkey" FOREIGN KEY ("gestionId") REFERENCES "Gestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActividadEvaluativa" ADD CONSTRAINT "ActividadEvaluativa_docenteMateriaCursoId_fkey" FOREIGN KEY ("docenteMateriaCursoId") REFERENCES "DocenteMateriaCurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActividadEvaluativa" ADD CONSTRAINT "ActividadEvaluativa_trimestreId_fkey" FOREIGN KEY ("trimestreId") REFERENCES "Trimestre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActividadEvaluativa" ADD CONSTRAINT "ActividadEvaluativa_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "DimensionEvaluacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaActividad" ADD CONSTRAINT "NotaActividad_actividadEvaluativaId_fkey" FOREIGN KEY ("actividadEvaluativaId") REFERENCES "ActividadEvaluativa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaActividad" ADD CONSTRAINT "NotaActividad_inscripcionId_fkey" FOREIGN KEY ("inscripcionId") REFERENCES "Inscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaActividad" ADD CONSTRAINT "NotaActividad_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitacoraClase" ADD CONSTRAINT "BitacoraClase_docenteMateriaCursoId_fkey" FOREIGN KEY ("docenteMateriaCursoId") REFERENCES "DocenteMateriaCurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitacoraClase" ADD CONSTRAINT "BitacoraClase_trimestreId_fkey" FOREIGN KEY ("trimestreId") REFERENCES "Trimestre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calificacion" ADD CONSTRAINT "Calificacion_inscripcionId_fkey" FOREIGN KEY ("inscripcionId") REFERENCES "Inscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calificacion" ADD CONSTRAINT "Calificacion_docenteMateriaCursoId_fkey" FOREIGN KEY ("docenteMateriaCursoId") REFERENCES "DocenteMateriaCurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calificacion" ADD CONSTRAINT "Calificacion_trimestreId_fkey" FOREIGN KEY ("trimestreId") REFERENCES "Trimestre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalificacionDimension" ADD CONSTRAINT "CalificacionDimension_calificacionId_fkey" FOREIGN KEY ("calificacionId") REFERENCES "Calificacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalificacionDimension" ADD CONSTRAINT "CalificacionDimension_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "DimensionEvaluacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialCalificacion" ADD CONSTRAINT "HistorialCalificacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialCalificacion" ADD CONSTRAINT "HistorialCalificacion_calificacionId_fkey" FOREIGN KEY ("calificacionId") REFERENCES "Calificacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromedioFinal" ADD CONSTRAINT "PromedioFinal_inscripcionId_fkey" FOREIGN KEY ("inscripcionId") REFERENCES "Inscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromedioFinal" ADD CONSTRAINT "PromedioFinal_docenteMateriaCursoId_fkey" FOREIGN KEY ("docenteMateriaCursoId") REFERENCES "DocenteMateriaCurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptoPago" ADD CONSTRAINT "ConceptoPago_gestionId_fkey" FOREIGN KEY ("gestionId") REFERENCES "Gestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_inscripcionId_fkey" FOREIGN KEY ("inscripcionId") REFERENCES "Inscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_conceptoPagoId_fkey" FOREIGN KEY ("conceptoPagoId") REFERENCES "ConceptoPago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
