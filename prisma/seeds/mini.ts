// prisma/seeds/mini.ts
//
// PERFIL "mini": un colegio MUY pequeño pero COMPLETO, para probar todo de punta a punta sin ruido.
//
//   · 3 docentes: doc01, doc02 y el propio DIRECTOR (una sola persona con rol DIRECTOR + DOCENTE).
//   · 3 cursos por gestión (1.° A, 2.° A, 3.° A de secundaria) con 2 estudiantes cada uno = 6 por año.
//   · 3 gestiones: año-2 y año-1 CERRADAS (p. ej. 2024 y 2025) y la actual (2026) en el TERCER trimestre
//     (T1 y T2 cerrados, T3 abierto y 100 % calificado → se puede probar el cierre).
//   · Las tres gestiones traen el detalle completo: horarios sin choques, actividades por dimensión (Ser/Saber/
//     Hacer/Decidir), notas, calificaciones, asistencia clase por clase + resúmenes, promedios finales (años
//     cerrados), tutores y pagos.
//
// Estudiantes (CI V00001..V00010) y su recorrido — todos los cursos de todos los años quedan con 2 alumnos:
//   A V00001  2026: 1.° ALTO, asistencia perfecta
//   B V00002  2026: 1.° REPRUEBA Matemáticas (aprobará/reprobará según el cierre), asistencia 88 %
//   C V00003  2025: 1.° → 2026: 2.°                         · medio
//   D V00004  2025: 1.° → 2026: 2.°                         · asistencia CRÍTICA (~52 %, sale en alertas)
//   E V00005  2024: 1.° → 2025: 2.° → 2026: 3.°             · alto
//   F V00006  igual que E, pero se RETIRA en el 2.° trimestre de 2026
//   G V00007  2024: 2.° → 2025: 3.° (egresa)
//   H V00008  2024: 2.° → 2025: 3.° REPRUEBA Matemáticas (no egresa)
//   I V00009  2024: 3.° (egresa)
//   J V00010  2024: 3.° se RETIRA en el 2.° trimestre
//
// Cuentas (solo desarrollo): director / admin1234 (entra como Director y como Docente) · secretaria / sec1234 ·
//   doc01, doc02 / doc1234 · est_v001..est_v006 / est1234 · tut_v001..tut_v003 / tut1234
//
// Determinista. Se siembra en unos segundos.
import bcrypt from 'bcryptjs'
import { MATERIAS } from '../seed.catalogo.js'
import {
  crearDirector, crearSecretaria, crearDocentes, crearGestion, crearDimensiones, crearConceptosPago,
  crearCursos, crearEstudiantes, mesRel, mostrarCredenciales, ultimoDia, utc, nombreDe, apellidoDe,
  MATERIAS_DICTADAS, type Ctx, type Perfil,
} from './_comun.js'

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES'] as const
const DIA_UTC = [1, 2, 3, 4, 5]
const PERIODOS: Array<[string, string]> = [['08:00', '08:45'], ['08:45', '09:30'], ['09:30', '10:15'], ['10:30', '11:15'], ['11:15', '12:00'], ['12:00', '12:45']]
const hora = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`)
const HORAS: Record<string, number> = Object.fromEntries(MATERIAS.map(m => [m.codigo, m.horas]))
const MOTIVOS = ['Certificado médico', 'Permiso familiar', 'Trámite de documentos']
const DIM = [
  { nombre: 'Ser', max: 5, peso: 5 }, { nombre: 'Saber', max: 100, peso: 45 },
  { nombre: 'Hacer', max: 100, peso: 40 }, { nombre: 'Decidir', max: 100, peso: 10 },
] as const
const ACT_NOMBRE: Record<string, string> = { Ser: 'Autoevaluación de valores', Saber: 'Examen escrito', Hacer: 'Trabajo práctico', Decidir: 'Participación y proyecto' }

// Reparto de materias entre los 3 docentes: 10 + 10 + 9 horas por curso. Con 3 cursos cada docente tiene ≤ 30 h
// (los 30 huecos semanales), así que el horario sale perfecto y SIN choques.
const GRUPO: Record<string, 0 | 1 | 2> = { MAT: 0, LEN: 0, CNA: 1, CSO: 1, ART: 1, ING: 2, EFI: 2, TEC: 2 }

type Estado = 'PROMUEVE' | 'REPRUEBA_MAT' | 'RETIRO'
interface Spec { i: number; grado: number; estado: Estado; trimestres: number }

// Recorrido de cada estudiante por año (offset 2 = hace dos años, 1 = el año pasado, 0 = actual)
const PLAN: Record<number, Spec[]> = {
  2: [
    { i: 5, grado: 1, estado: 'PROMUEVE', trimestres: 3 }, { i: 6, grado: 1, estado: 'PROMUEVE', trimestres: 3 },
    { i: 7, grado: 2, estado: 'PROMUEVE', trimestres: 3 }, { i: 8, grado: 2, estado: 'PROMUEVE', trimestres: 3 },
    { i: 9, grado: 3, estado: 'PROMUEVE', trimestres: 3 }, { i: 10, grado: 3, estado: 'RETIRO', trimestres: 2 },
  ],
  1: [
    { i: 3, grado: 1, estado: 'PROMUEVE', trimestres: 3 }, { i: 4, grado: 1, estado: 'PROMUEVE', trimestres: 3 },
    { i: 5, grado: 2, estado: 'PROMUEVE', trimestres: 3 }, { i: 6, grado: 2, estado: 'PROMUEVE', trimestres: 3 },
    { i: 7, grado: 3, estado: 'PROMUEVE', trimestres: 3 }, { i: 8, grado: 3, estado: 'REPRUEBA_MAT', trimestres: 3 },
  ],
  0: [
    { i: 1, grado: 1, estado: 'PROMUEVE', trimestres: 3 }, { i: 2, grado: 1, estado: 'REPRUEBA_MAT', trimestres: 3 },
    { i: 3, grado: 2, estado: 'PROMUEVE', trimestres: 3 }, { i: 4, grado: 2, estado: 'PROMUEVE', trimestres: 3 },
    { i: 5, grado: 3, estado: 'PROMUEVE', trimestres: 3 }, { i: 6, grado: 3, estado: 'RETIRO', trimestres: 2 },
  ],
}

// Habilidad base y % de asistencia de cada estudiante (igual todos los años)
const HABILIDAD: Record<number, number> = { 1: 0.90, 2: 0.72, 3: 0.75, 4: 0.66, 5: 0.88, 6: 0.72, 7: 0.74, 8: 0.68, 9: 0.70, 10: 0.62 }
const ASISTENCIA: Record<number, number> = { 1: 100, 2: 88, 3: 94, 4: 52, 5: 98, 6: 90, 7: 96, 8: 85, 9: 95, 10: 80 }

const redondea = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))

const DESPLAZ_ANIO: Record<number, number> = { 2: -0.07, 1: -0.03, 0: 0 }
const DESPLAZ_MAT: Record<string, Record<number, number>> = { MAT: { 2: -0.04, 1: -0.02, 0: 0 }, ART: { 2: 0.03, 1: 0.03, 0: 0.03 } }
function fraccion(s: Spec, offset: number, cod: string, t: number): number {
  if (s.estado === 'REPRUEBA_MAT' && cod === 'MAT') return 0.36 + ((s.i + t) % 8) / 100       // Matemáticas ~40
  const ruido = (((s.i * 7 + cod.charCodeAt(0) * 13 + t * 5 + offset) % 9) - 4) / 100
  const f = HABILIDAD[s.i] + DESPLAZ_ANIO[offset] + (DESPLAZ_MAT[cod]?.[offset] ?? 0) + [-0.015, 0, 0.015][t] + ruido
  return clamp(Math.max(f, 0.545), 0, 0.99)                              // quien promueve no baja de ~54
}

function estadoAsistencia(i: number, di: number): 'PRESENTE' | 'AUSENTE' | 'RETRASO' {
  if (di % 17 === 9 && ASISTENCIA[i] < 100) return 'RETRASO'
  return ((di * 37 + i * 61) % 100) < ASISTENCIA[i] ? 'PRESENTE' : 'AUSENTE'
}

/** Horario perfecto: en cada hueco semanal s, el curso c lo da el docente (c+s) % 3. Devuelve bloques por curso. */
function armarHorario(nCursos: number) {
  const porCursoYGrupo: { curso: number; slot: number; cod: string | null }[] = []
  for (let c = 0; c < nCursos; c++) {
    for (let k = 0 as 0 | 1 | 2; k < 3; k = (k + 1) as 0 | 1 | 2) {
      const slots = Array.from({ length: 30 }, (_, s) => s).filter(s => (c + s) % 3 === k)
      const quedan: Record<string, number> = Object.fromEntries(MATERIAS_DICTADAS.filter(cod => GRUPO[cod] === k).map(cod => [cod, HORAS[cod]]))
      const orden = Object.keys(quedan)
      let j = 0
      for (const s of slots) {
        let cod: string | null = null
        for (let intento = 0; intento < orden.length; intento++) {
          const cand = orden[(j + intento) % orden.length]
          if (quedan[cand] > 0) { cod = cand; j = (j + intento + 1) % orden.length; break }
        }
        if (cod) quedan[cod]--
        porCursoYGrupo.push({ curso: c, slot: s, cod })   // cod null = hueco libre del docente 2 (9 h en 10 huecos)
      }
    }
  }
  return porCursoYGrupo
}

export const mini: Perfil = {
  descripcion: 'Colegio mínimo y completo: 3 docentes (uno es el Director), 3 cursos × 2 estudiantes, gestiones 2 años atrás y año pasado CERRADAS + la actual en T3, con notas, asistencia, horarios, tutores y pagos.',
  async sembrar(ctx: Ctx) {
    const c = ctx.prisma
    const t0 = Date.now()
    const paso = (m: string) => console.log(`✓ ${m} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)

    // ── Personal: Director que TAMBIÉN es docente ─────────────────────────
    const director = await crearDirector(ctx)
    const secretaria = await crearSecretaria(ctx)
    const docentesBase = await crearDocentes(ctx, 2)                                  // doc01, doc02
    const dirUsuario = await c.usuario.findFirstOrThrow({ where: { username: 'director' } })
    await c.usuario.update({ where: { id: dirUsuario.id }, data: { roles: ['DIRECTOR', 'DOCENTE'] } })
    const docDirector = await c.docente.create({ data: { personaId: director.personaId, usuarioId: dirUsuario.id, especialidad: 'Técnica Tecnológica' } })
    const docentes = [docentesBase[0], docentesBase[1], docDirector]                 // grupo 0, 1, 2
    const secUsuario = await c.usuario.findFirstOrThrow({ where: { username: 'secretaria' } })
    paso('director (también docente), secretaria, 3 docentes')

    // ── Estudiantes y tutores (viven los 3 años) ──────────────────────────
    const estudiantes = await crearEstudiantes(ctx, 10, { prefijoCi: 'V', conCuenta: 6 })
    await c.$executeRawUnsafe(`UPDATE "Estudiante" SET rude = 'R' || LPAD(id::text, 9, '0') WHERE rude IS NULL`)
    const estId = (i: number) => estudiantes[i - 1].estudianteId
    const hashTut = await bcrypt.hash('tut1234', 4)
    const parejas = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]
    for (let n = 0; n < parejas.length; n++) {
      const p = await c.persona.create({ data: { ci: `T${String(n + 1).padStart(5, '0')}`, nombre: nombreDe(n * 3 + 1), apellido: apellidoDe(n * 7 + 2), telefono: `7910000${n}` } })
      const t = await c.tutor.create({ data: { personaId: p.id, ocupacion: ['Comerciante', 'Chofer', 'Enfermera', 'Costurera', 'Mecánico'][n] } })
      if (n < 3) {
        const u = await c.usuario.create({ data: { username: `tut_v${String(n + 1).padStart(3, '0')}`, passwordHash: hashTut, roles: ['TUTOR'] } })
        await c.tutor.update({ where: { id: t.id }, data: { usuarioId: u.id } })
      }
      await c.tutorEstudiante.createMany({ data: parejas[n].map((i, k) => ({
        tutorId: t.id, estudianteId: estId(i), parentesco: n % 2 ? 'MADRE' as const : 'PADRE' as const, esTutorPrincipal: true, esApoderado: k === 0,
      })) })
    }
    paso('10 estudiantes (6 con cuenta), 5 tutores (3 con cuenta)')

    // ── Una gestión completa por año ──────────────────────────────────────
    const resumen: string[] = []
    for (const offset of [2, 1, 0]) {
      const anio = ctx.ANIO - offset
      const actual = offset === 0
      const meses = actual
        ? [mesRel(ctx.ANCLA, -2), mesRel(ctx.ANCLA, -1), mesRel(ctx.ANCLA, 0)] as [{ y: number; m: number }, { y: number; m: number }, { y: number; m: number }]
        : [{ y: anio, m: 3 }, { y: anio, m: 6 }, { y: anio, m: 9 }] as [{ y: number; m: number }, { y: number; m: number }, { y: number; m: number }]
      const { gestion, trimestres } = await crearGestion(ctx, {
        anio, activa: actual, descripcion: actual ? `Gestión Escolar ${anio} (mini, en el 3.er trimestre)` : `Gestión Escolar ${anio} (cerrada)`,
        directorId: director.id, meses, cerrados: actual ? [true, true, false] : [true, true, true],
      })
      const gestionId = gestion.id
      await crearDimensiones(ctx, gestionId)
      await crearConceptosPago(ctx, gestionId)
      const dimId = new Map((await c.dimensionEvaluacion.findMany({ where: { gestionId } })).map(d => [d.nombre, d.id]))
      const cursos = await crearCursos(ctx, gestionId, [1, 2, 3], ['A'])

      // Asignaciones docente-materia-curso
      const dmcFilas = await c.docenteMateriaCurso.createManyAndReturn({
        data: cursos.flatMap(cu => MATERIAS_DICTADAS.map(cod => ({ gestionId, cursoId: cu.id, materiaId: ctx.materias[cod].id, docenteId: docentes[GRUPO[cod]].id }))),
      })
      const codDe = new Map(MATERIAS_DICTADAS.map(cod => [ctx.materias[cod].id, cod]))
      const dmcs = dmcFilas.map(f => ({ id: f.id, cursoId: f.cursoId, codigo: codDe.get(f.materiaId)! }))
      const dmcDe = (cursoId: number, cod: string) => dmcs.find(d => d.cursoId === cursoId && d.codigo === cod)!

      // Horarios (perfectos: sin choques de docente ni de curso)
      const diasDeDmc = new Map<number, Set<number>>()
      const bloques = armarHorario(cursos.length).filter(b => b.cod).map(b => {
        const cu = cursos[b.curso]
        const d = dmcDe(cu.id, b.cod!)
        const dia = b.slot % 5, p = Math.floor(b.slot / 5)
        diasDeDmc.set(d.id, (diasDeDmc.get(d.id) ?? new Set()).add(DIA_UTC[dia]))
        return { docenteMateriaCursoId: d.id, diaSemana: DIAS[dia], horaInicio: hora(PERIODOS[p][0]), horaFin: hora(PERIODOS[p][1]), aula: `Aula ${cu.grado}°${cu.paralelo}` }
      })
      await c.horario.createMany({ data: bloques })

      // Inscripciones
      const specs = PLAN[offset]
      const cursoDeGrado = (g: number) => cursos.find(cu => cu.grado === g)!
      const inscripciones = await c.inscripcion.createManyAndReturn({
        data: specs.map(s => ({
          estudianteId: estId(s.i), cursoId: cursoDeGrado(s.grado).id, gestionId, fechaInscripcion: utc(meses[0].y, meses[0].m, 1),
          ...(s.estado === 'RETIRO' ? { estadoInscripcion: 'RETIRADA' as const, fechaRetiro: utc(meses[1].y, meses[1].m, 10), observaciones: 'Cambio de domicilio' } : {}),
        })),
      })
      const inscDe = new Map(specs.map((s, n) => [s.i, inscripciones[n]]))

      // Actividades (4 por materia y trimestre) + notas + calificaciones + calificación por dimensión
      const actFilas = await c.actividadEvaluativa.createManyAndReturn({
        data: dmcs.flatMap(d => trimestres.flatMap(t => DIM.map(dm => ({
          docenteMateriaCursoId: d.id, trimestreId: t.id, dimensionId: dimId.get(dm.nombre)!, nombre: ACT_NOMBRE[dm.nombre],
          puntajeMaximo: dm.max, peso: 1, fecha: new Date(t.fechaInicio.getTime() + 14 * 86400000),
        })))),
        select: { id: true, docenteMateriaCursoId: true, trimestreId: true, dimensionId: true },
      })
      const actId = new Map(actFilas.map(a => [`${a.docenteMateriaCursoId}-${a.trimestreId}-${a.dimensionId}`, a.id]))
      const notas: { actividadEvaluativaId: number; inscripcionId: number; nota: number }[] = []
      const califs: { inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; promedioTrimestral: number }[] = []
      const finales: { inscripcionId: number; docenteMateriaCursoId: number; promedioFinal: number; resultado: 'PROMOVIDO' | 'REPROBADO' }[] = []
      const califDim: { clave: string; dimensionId: number; promedio: number }[] = []
      const aprueba = new Map<number, boolean>()
      for (const s of specs) {
        const insc = inscDe.get(s.i)!
        let todo = true
        for (const d of dmcs.filter(x => x.cursoId === insc.cursoId)) {
          const notasTrim: number[] = []
          for (let t = 0; t < s.trimestres; t++) {
            const fr = fraccion(s, offset, d.codigo, t)
            for (const dm of DIM) {
              notas.push({ actividadEvaluativaId: actId.get(`${d.id}-${trimestres[t].id}-${dimId.get(dm.nombre)}`)!, inscripcionId: insc.id, nota: redondea(dm.max * fr) })
              califDim.push({ clave: `${insc.id}-${d.id}-${trimestres[t].id}`, dimensionId: dimId.get(dm.nombre)!, promedio: redondea(fr * dm.peso) })
            }
            const prom = redondea(fr * 100)
            notasTrim.push(prom)
            califs.push({ inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trimestres[t].id, promedioTrimestral: prom })
          }
          if (!actual && s.trimestres === 3) {
            const pf = redondea(notasTrim.reduce((a, b) => a + b, 0) / 3)
            if (pf < 51) todo = false
            finales.push({ inscripcionId: insc.id, docenteMateriaCursoId: d.id, promedioFinal: pf, resultado: pf >= 51 ? 'PROMOVIDO' : 'REPROBADO' })
          }
        }
        aprueba.set(insc.id, todo)
      }
      await c.notaActividad.createMany({ data: notas })
      const calFilas = await c.calificacion.createManyAndReturn({ data: califs, select: { id: true, inscripcionId: true, docenteMateriaCursoId: true, trimestreId: true } })
      const calId = new Map(calFilas.map(x => [`${x.inscripcionId}-${x.docenteMateriaCursoId}-${x.trimestreId}`, x.id]))
      await c.calificacionDimension.createMany({ data: califDim.map(x => ({ calificacionId: calId.get(x.clave)!, dimensionId: x.dimensionId, promedio: x.promedio })) })
      if (finales.length) await c.promedioFinal.createMany({ data: finales })
      if (!actual) {
        for (const s of specs.filter(x => x.trimestres === 3)) {
          const insc = inscDe.get(s.i)!
          await c.inscripcion.update({ where: { id: insc.id }, data: { resultado: aprueba.get(insc.id) ? 'PROMOVIDO' : 'REPROBADO' } })
        }
      }
      if (actual) {
        // Un caso de corrección con historial (para probar esa pantalla)
        await c.historialCalificacion.create({
          data: { calificacionId: calFilas[0].id, promedioAnterior: 85, promedioNuevo: califs[0].promedioTrimestral, motivo: 'Revisión de examen', usuarioId: dirUsuario.id },
        })
      }

      // Asistencia clase por clase (según el horario) + resúmenes
      type Est = 'PRESENTE' | 'AUSENTE' | 'RETRASO' | 'JUSTIFICADO'
      const asis: { inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; fecha: Date; estado: Est; justificacion?: string }[] = []
      const res: { inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; totalClases: number; totalPresente: number; totalAusente: number; totalRetraso: number; totalJustificado: number; porcentaje: number }[] = []
      for (const d of dmcs) {
        const dias = diasDeDmc.get(d.id) ?? new Set<number>()
        for (let t = 0; t < 3; t++) {
          const { y, m } = meses[t]
          const fechas: Date[] = []
          for (let dd = 1; dd <= ultimoDia(y, m); dd++) {
            const f = utc(y, m, dd)
            if (dias.has(f.getUTCDay()) && f.getTime() <= ctx.ANCLA.getTime()) fechas.push(f)
          }
          for (const s of specs) {
            const insc = inscDe.get(s.i)!
            if (insc.cursoId !== d.cursoId || t >= s.trimestres || !fechas.length) continue
            const r = { p: 0, a: 0, r: 0, j: 0 }
            fechas.forEach((fecha, di) => {
              let estado: Est = estadoAsistencia(s.i, di)
              let justificacion: string | undefined
              if (estado === 'AUSENTE' && (di + s.i) % 4 === 0) { estado = 'JUSTIFICADO'; justificacion = MOTIVOS[(di + s.i) % MOTIVOS.length] }
              asis.push({ inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trimestres[t].id, fecha, estado, ...(justificacion ? { justificacion } : {}) })
              if (estado === 'PRESENTE') r.p++; else if (estado === 'AUSENTE') r.a++; else if (estado === 'JUSTIFICADO') r.j++; else r.r++
            })
            res.push({
              inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trimestres[t].id, totalClases: fechas.length,
              totalPresente: r.p, totalAusente: r.a, totalRetraso: r.r, totalJustificado: r.j, porcentaje: redondea(((r.p + r.j) / fechas.length) * 100),
            })
          }
        }
      }
      for (let i = 0; i < asis.length; i += 4000) await c.asistencia.createMany({ data: asis.slice(i, i + 4000) })
      await c.resumenAsistencia.createMany({ data: res })

      // Pagos
      const [cMat, cMen, cMaterial] = await c.conceptoPago.findMany({ where: { gestionId }, orderBy: { id: 'asc' } })
      let rec = 1
      const pagos: { inscripcionId: number; conceptoPagoId: number; montoOriginal: number; montoPagado: number; metodoPago: 'EFECTIVO' | 'TRANSFERENCIA' | 'QR'; estado: 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'ANULADO'; numeroRecibo: string; registradoPorId: number; fechaPago: Date }[] = []
      const mk = (i: number, cp: typeof cMat, pagado: number, estado: 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'ANULADO', metodo: 'EFECTIVO' | 'TRANSFERENCIA' | 'QR' = 'EFECTIVO') =>
        pagos.push({ inscripcionId: inscDe.get(i)!.id, conceptoPagoId: cp.id, montoOriginal: Number(cp.monto), montoPagado: pagado, metodoPago: metodo, estado,
          numeroRecibo: `REC-${anio}-${String(rec++).padStart(4, '0')}`, registradoPorId: secUsuario.id, fechaPago: utc(meses[0].y, meses[0].m, 5) })
      for (const s of specs) {
        if (actual && s.i === 6) { mk(s.i, cMat, Number(cMat.monto), 'ANULADO'); continue }          // retirado
        if (actual && s.i === 4) continue                                                             // no pagó nada
        if (actual && s.i === 2) { mk(s.i, cMat, 60, 'PARCIAL', 'TRANSFERENCIA'); continue }          // pago parcial
        if (actual && s.i === 3) { mk(s.i, cMat, 0, 'PENDIENTE'); continue }                          // pendiente
        mk(s.i, cMat, Number(cMat.monto), 'PAGADO')
        mk(s.i, cMen, Number(cMen.monto), 'PAGADO', s.i % 2 ? 'QR' : 'EFECTIVO')
        if (s.i % 3 === 1) mk(s.i, cMaterial, Number(cMaterial.monto), 'PAGADO', 'TRANSFERENCIA')
      }
      await c.pago.createMany({ data: pagos })

      resumen.push(`${anio}${actual ? ' (actual, T3 abierto)' : ' (cerrada)'}: ${specs.length} inscripciones, ${califs.length} calificaciones, ${notas.length} notas, ${asis.length} asistencias, ${pagos.length} pagos`)
      paso(`gestión ${anio}: ${cursos.length} cursos, ${specs.length} inscripciones, ${califs.length} calificaciones, ${asis.length} asistencias`)
    }

    // ── Verificación ──────────────────────────────────────────────────────
    console.log('\nVerificación:')
    const v = ctx.verificar
    v((await c.gestion.count()) === 3, '3 gestiones (año-2, año-1 y actual)')
    v((await c.gestion.count({ where: { activa: true } })) === 1, 'solo la actual está activa')
    v((await c.docente.count()) === 3, '3 docentes')
    const dirUser = await c.usuario.findFirstOrThrow({ where: { username: 'director' }, include: { director: true, docente: true } })
    v(dirUser.roles.includes('DIRECTOR') && dirUser.roles.includes('DOCENTE') && !!dirUser.director && !!dirUser.docente && dirUser.director.personaId === dirUser.docente.personaId,
      'el Director es también Docente (misma persona, misma cuenta)')
    const porCurso = await c.curso.findMany({ select: { grado: true, gestion: { select: { anio: true } }, _count: { select: { inscripciones: true } } } })
    v(porCurso.length === 9 && porCurso.every(x => x._count.inscripciones === 2), '9 cursos (3 por año), cada uno con exactamente 2 estudiantes')
    const actualG = await c.gestion.findFirstOrThrow({ where: { activa: true } })
    v((await c.trimestre.count({ where: { gestionId: actualG.id, cerrado: true } })) === 2, 'gestión actual: T1 y T2 cerrados, T3 abierto')
    v((await c.trimestre.count({ where: { gestion: { activa: false }, cerrado: true } })) === 6, 'gestiones anteriores: los 6 trimestres cerrados')
    const choques = await c.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "Horario" a
      JOIN "DocenteMateriaCurso" da ON da.id = a."docenteMateriaCursoId"
      JOIN "Horario" b ON b.id > a.id AND b."diaSemana" = a."diaSemana" AND a."horaInicio" < b."horaFin" AND b."horaInicio" < a."horaFin"
      JOIN "DocenteMateriaCurso" db ON db.id = b."docenteMateriaCursoId" AND db."gestionId" = da."gestionId"
      WHERE da."docenteId" = db."docenteId" OR da."cursoId" = db."cursoId"`
    v(Number(choques[0].n) === 0, 'horarios sin choques de docente ni de curso')
    const carga = await c.$queryRaw<{ n: bigint }[]>`
      SELECT MAX(h) AS n FROM (SELECT SUM(1) AS h FROM "Horario" hr JOIN "DocenteMateriaCurso" d ON d.id = hr."docenteMateriaCursoId" GROUP BY d."docenteId", d."gestionId") x`
    v(Number(carga[0].n) <= 30, `ningún docente supera los 30 huecos semanales (máx. ${carga[0].n})`)
    v((await c.promedioFinal.count({ where: { inscripcion: { gestion: { activa: false } } } })) > 0 && (await c.promedioFinal.count({ where: { inscripcion: { gestion: { activa: true } } } })) === 0,
      'promedios finales en los años cerrados; la gestión actual aún no (nacen al cerrar T3)')
    const reprob = await c.inscripcion.findMany({ where: { resultado: 'REPROBADO' }, select: { estudiante: { select: { persona: { select: { ci: true } } } }, gestion: { select: { anio: true } } } })
    v(reprob.length === 1 && reprob[0].estudiante.persona.ci === 'V00008', 'un reprobado en el pasado (V00008, 3.° del año pasado)')
    v((await c.asistencia.count()) > 0 && (await c.resumenAsistencia.count()) > 0, 'asistencias y resúmenes en las 3 gestiones')
    const trayectoria = await c.inscripcion.findMany({ where: { estudianteId: estId(5) }, orderBy: { gestion: { anio: 'asc' } }, select: { gestion: { select: { anio: true } }, curso: { select: { grado: true } } } })
    v(trayectoria.length === 3, `V00005 recorre 3 gestiones: ${trayectoria.map(t => `${t.gestion.anio} ${t.curso.grado}°`).join(' → ')}`)

    console.log('\nRESUMEN:')
    resumen.forEach(r => console.log(`  ${r}`))
    mostrarCredenciales([
      'director / admin1234 (Director + Docente) · secretaria / sec1234',
      'doc01, doc02 / doc1234 · est_v001..est_v006 / est1234 · tut_v001..tut_v003 / tut1234',
    ])
    console.log('\nPRUEBAS SUGERIDAS: Cerrar el T3 de 2026 (B reprueba Matemáticas, F está retirado) · Promoción · Historial (V00005: 3 años; V00008: reprobado) · '
      + 'Comparativo 2024-2025-2026 · Asistencia (D con ~52 % en alertas) · Pagos (parcial, pendiente, anulado, sin pagar) · Entrar como "director" y cambiar entre vista Director y Docente.')
  },
}