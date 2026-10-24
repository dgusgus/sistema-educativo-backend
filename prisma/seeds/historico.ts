// prisma/seeds/historico.ts
//
// PERFIL "historico": el perfil "carga" (900 inscritos este año, con todo el detalle) MÁS dos gestiones
// anteriores YA CERRADAS (año-2 y año-1, p. ej. 2024 y 2025) para probar Historial académico,
// Comparativo entre gestiones, boletines/libretas de años pasados y certificados.
//
// Continuidad real (no son estudiantes sueltos por año):
//   · Un estudiante de 4.° este año estuvo en 3.° el año pasado y en 2.° hace dos años.
//   · ~4 % de los actuales repite curso este año (el año pasado quedó REPROBADO en el mismo grado).
//   · ~3 % repitió hace dos años (REPROBADO en año-2, aprobó el mismo grado en año-1).
//   · Egresados: 150 que terminaron 6.° el año pasado y 150 que terminaron hace dos años (no están en la gestión actual).
//   · Retirados: ~20 por año, con notas solo de los trimestres que cursaron.
//
// Tendencias a propósito (para que el comparativo muestre algo legible):
//   · Mejora general año a año; Matemática mejora más; 3.° de 2024 fue un grupo flojo; Artes siempre alta.
//   · Asistencia sube cada año (~91 % → ~94 %).
//
// Qué trae cada gestión cerrada: 24 cursos A-D, asignaciones docente-materia (los mismos doc01..doc37),
// Calificacion por trimestre, PromedioFinal, resultado de cada inscripción y ResumenAsistencia.
// NO trae actividades ni asistencia clase por clase (el Historial, los reportes y los boletines no lo necesitan
// y así el perfil sigue siendo rápido). Eso sí lo tiene la gestión actual, heredada de "carga".
//
// Cuentas: las de "carga" (director / admin1234 · secretaria / sec1234 · doc01..doc37 / doc1234 ·
// est_v001..est_v060 / est1234 · tut_v001..tut_v030 / tut1234).
// Determinista. Tarda lo de "carga" + ~20-30 s.
import { MATERIAS } from '../seed.catalogo.js'
import {
  crearGestion, crearDimensiones, crearCursos, crearEstudiantes, MATERIAS_DICTADAS, utc, type Ctx, type Perfil,
} from './_comun.js'
import { carga } from './carga.js'

const GRADOS = [1, 2, 3, 4, 5, 6]
const PARALELOS = ['A', 'B', 'C', 'D']
const HORAS: Record<string, number> = Object.fromEntries(MATERIAS.map(m => [m.codigo, m.horas]))

type Estado = 'PROMUEVE' | 'REPRUEBA' | 'RETIRO'
interface Spec { anio: number; estudianteId: number; gi: number; grado: number; estado: Estado; trimestresCursados: number }

async function insertar<T>(filas: T[], tam: number, fn: (lote: T[]) => Promise<unknown>) {
  for (let i = 0; i < filas.length; i += tam) await fn(filas.slice(i, i + tam))
}
const redondea = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))

// ─── Cómo se generan las notas de los años cerrados ──────────────────────────
// Posición del año respecto al actual: 2 = hace dos años, 1 = el año pasado.
const DESPLAZ_ANIO: Record<number, number> = { 2: -0.09, 1: -0.05 }
const DESPLAZ_MATERIA: Record<number, Record<string, number>> = {
  2: { MAT: -0.05, ING: -0.03, ART: 0.03 },
  1: { MAT: -0.025, ING: -0.015, ART: 0.03 },
}
const DESPLAZ_TRIM = [-0.015, 0, 0.015]
/** Fracción de nota (0-1) del estudiante en una materia y trimestre del año cerrado. */
function fraccion(s: Spec, hace: number, materia: string, trim: number): number {
  const habilidad = 0.58 + ((s.gi * 37 + 13) % 40) / 100                      // 0.58-0.97, igual todos los años
  const grupoFlojo = hace === 2 && s.grado === 3 ? -0.04 : 0                   // 3.° de hace dos años fue un grupo flojo
  const ruido = (((s.gi * 7 + materia.charCodeAt(0) * 13 + trim * 5 + hace) % 9) - 4) / 100
  let f = habilidad + DESPLAZ_ANIO[hace] + (DESPLAZ_MATERIA[hace][materia] ?? 0) + DESPLAZ_TRIM[trim] + grupoFlojo + ruido
  if (s.estado === 'REPRUEBA') {
    if (materia === 'MAT') f = 0.36 + ((s.gi + trim) % 8) / 100                 // Matemática ~40: reprueba
    else if (materia === 'CNA' && s.gi % 2 === 0) f = 0.44 + ((s.gi + trim) % 5) / 100
    else f = Math.min(f, 0.78)
  } else if (materia !== 'ART') {
    f = Math.max(f, 0.545)                                                       // quien promueve nunca baja de ~54
  }
  return clamp(f, 0, 0.99)
}

/** % de asistencia objetivo: cada alumno tiene su perfil fijo, el colegio mejora año a año. */
function pctAsistencia(gi: number, hace: number): number {
  const r = gi % 10
  const base = r <= 5 ? 97 : r <= 7 ? 90 : r === 8 ? 72 : 52
  return clamp(base - (hace === 2 ? 2 : 0.5) + ((gi * 3) % 5) * 0.4, 35, 100)
}

export const historico: Perfil = {
  descripcion: '"carga" (900 inscritos, detalle completo) + 2 gestiones anteriores CERRADAS con continuidad de estudiantes, repetidores, egresados y retirados.',
  async sembrar(ctx: Ctx) {
    const t0 = Date.now()
    const paso = (m: string) => console.log(`✓ ${m} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)

    // 1) Gestión actual completa (idéntica al perfil "carga")
    await carga.sembrar(ctx)
    const c = ctx.prisma
    console.log('\n── Gestiones anteriores ──')

    const director = await c.director.findFirstOrThrow()
    const docentes = await c.docente.findMany({ orderBy: { id: 'asc' }, take: MATERIAS_DICTADAS.reduce((s, cod) => s + HORAS[cod] + 1, 0) })

    // 2) Estudiantes actuales y su grado hoy
    const actuales = await c.inscripcion.findMany({
      where: { gestion: { anio: ctx.ANIO } },
      select: { estudianteId: true, curso: { select: { grado: true } }, estudiante: { select: { persona: { select: { ci: true } } } } },
    })
    const actual = actuales.map(a => ({ estudianteId: a.estudianteId, grado: a.curso.grado, gi: Number(a.estudiante.persona.ci!.slice(1)) }))

    // 3) Estudiantes que ya egresaron / se retiraron antes (no están en la gestión actual)
    const E = await crearEstudiantes(ctx, 150, { desde: 1, prefijoCi: 'E' })   // terminaron 6.° el año pasado
    const F = await crearEstudiantes(ctx, 150, { desde: 1, prefijoCi: 'F' })   // terminaron 6.° hace dos años
    const X = await crearEstudiantes(ctx, 40,  { desde: 1, prefijoCi: 'X' })   // se retiraron (20 y 20)
    await c.$executeRawUnsafe(`UPDATE "Estudiante" SET rude = 'R' || LPAD(id::text, 9, '0') WHERE rude IS NULL`)

    // 4) Trayectoria de cada uno (año-2 = 2, año-1 = 1)
    const specs: Spec[] = []
    const Y2 = ctx.ANIO - 2, Y1 = ctx.ANIO - 1
    for (const a of actual) {
      const repite2026 = a.gi % 25 === 3                          // ~4 %: el año pasado reprobó este mismo grado
      const repitio2024 = !repite2026 && a.grado >= 2 && a.gi % 33 === 5   // ~3 %: reprobó hace dos años
      const base = { estudianteId: a.estudianteId, gi: a.gi }
      if (repite2026) {
        specs.push({ ...base, anio: Y1, grado: a.grado, estado: 'REPRUEBA', trimestresCursados: 3 })
        if (a.grado >= 2) specs.push({ ...base, anio: Y2, grado: a.grado - 1, estado: 'PROMUEVE', trimestresCursados: 3 })
      } else if (repitio2024) {
        specs.push({ ...base, anio: Y2, grado: a.grado - 1, estado: 'REPRUEBA', trimestresCursados: 3 })
        specs.push({ ...base, anio: Y1, grado: a.grado - 1, estado: 'PROMUEVE', trimestresCursados: 3 })
      } else {
        if (a.grado >= 2) specs.push({ ...base, anio: Y1, grado: a.grado - 1, estado: 'PROMUEVE', trimestresCursados: 3 })
        if (a.grado >= 3) specs.push({ ...base, anio: Y2, grado: a.grado - 2, estado: 'PROMUEVE', trimestresCursados: 3 })
      }
    }
    E.forEach(e => {
      specs.push({ anio: Y2, estudianteId: e.estudianteId, gi: 1000 + e.i, grado: 5, estado: 'PROMUEVE', trimestresCursados: 3 })
      specs.push({ anio: Y1, estudianteId: e.estudianteId, gi: 1000 + e.i, grado: 6, estado: 'PROMUEVE', trimestresCursados: 3 })
    })
    F.forEach(f => specs.push({ anio: Y2, estudianteId: f.estudianteId, gi: 2000 + f.i, grado: 6, estado: 'PROMUEVE', trimestresCursados: 3 }))
    X.forEach((x, n) => specs.push({
      anio: n < 20 ? Y2 : Y1, estudianteId: x.estudianteId, gi: 3000 + x.i, grado: GRADOS[n % 6],
      estado: 'RETIRO', trimestresCursados: n % 2 === 0 ? 1 : 2,
    }))
    paso(`${actual.length} actuales + ${E.length + F.length + X.length} egresados/retirados → ${specs.length} inscripciones históricas`)

    // 5) Una gestión cerrada por año
    const resumenAnios: string[] = []
    for (const anio of [Y2, Y1]) {
      const hace = ctx.ANIO - anio
      const { gestion, trimestres } = await crearGestion(ctx, {
        anio, activa: false, descripcion: `Gestión Escolar ${anio} (cerrada)`, directorId: director.id,
        meses: [{ y: anio, m: 3 }, { y: anio, m: 6 }, { y: anio, m: 9 }], cerrados: [true, true, true],
      })
      await crearDimensiones(ctx, gestion.id)
      const cursos = await crearCursos(ctx, gestion.id, GRADOS, PARALELOS)
      await c.curso.updateMany({ where: { gestionId: gestion.id }, data: { capacidad: 45 } })

      // mismas asignaciones que la gestión actual (h+1 docentes por materia)
      const pools = MATERIAS_DICTADAS.map(cod => HORAS[cod] + 1)
      const inicio: number[] = []
      pools.reduce((acc, h, i) => { inicio[i] = acc; return acc + h }, 0)
      const dmcFilas = await c.docenteMateriaCurso.createManyAndReturn({
        data: cursos.flatMap((cu, ci) => MATERIAS_DICTADAS.map((cod, mi) => ({
          gestionId: gestion.id, cursoId: cu.id, materiaId: ctx.materias[cod].id, docenteId: docentes[inicio[mi] + (ci % pools[mi])].id,
        }))),
      })
      const codDe = new Map(MATERIAS_DICTADAS.map(cod => [ctx.materias[cod].id, cod]))
      const dmcsDe = new Map<number, { id: number; codigo: string }[]>()
      for (const f of dmcFilas) dmcsDe.set(f.cursoId, [...(dmcsDe.get(f.cursoId) ?? []), { id: f.id, codigo: codDe.get(f.materiaId)! }])
      for (const l of dmcsDe.values()) l.sort((a, b) => MATERIAS_DICTADAS.indexOf(a.codigo as never) - MATERIAS_DICTADAS.indexOf(b.codigo as never))

      // Inscripciones: cada grado se reparte parejo entre A-D
      const delAnio = specs.filter(s => s.anio === anio).sort((a, b) => a.grado - b.grado || a.estudianteId - b.estudianteId)
      const contador = new Map<number, number>()
      const conCurso = delAnio.map(s => {
        const n = contador.get(s.grado) ?? 0
        contador.set(s.grado, n + 1)
        return { s, curso: cursos.find(cu => cu.grado === s.grado && cu.paralelo === PARALELOS[n % 4])! }
      })
      const inscripciones = await c.inscripcion.createManyAndReturn({
        data: conCurso.map(({ s, curso }) => ({
          estudianteId: s.estudianteId, cursoId: curso.id, gestionId: gestion.id, fechaInscripcion: utc(anio, 2, 1),
          ...(s.estado === 'RETIRO'
            ? { estadoInscripcion: 'RETIRADA' as const, fechaRetiro: utc(anio, s.trimestresCursados === 1 ? 5 : 8, 12), observaciones: 'Cambio de domicilio' }
            : {}),
        })),
      })

      // Notas, promedios finales, asistencia
      const califs: { inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; promedioTrimestral: number }[] = []
      const finales: { inscripcionId: number; docenteMateriaCursoId: number; promedioFinal: number; resultado: 'PROMOVIDO' | 'REPROBADO' }[] = []
      const resumenes: { inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; totalClases: number; totalPresente: number; totalAusente: number; totalRetraso: number; totalJustificado: number; porcentaje: number }[] = []
      const resultados: { id: number; resultado: 'PROMOVIDO' | 'REPROBADO' }[] = []

      inscripciones.forEach((insc, n) => {
        const { s } = conCurso[n]
        const dmcs = dmcsDe.get(insc.cursoId)!
        let aprueba = true
        dmcs.forEach(d => {
          const notas: number[] = []
          for (let t = 0; t < s.trimestresCursados; t++) {
            const nota = Math.round(fraccion(s, hace, d.codigo, t) * 100)
            notas.push(nota)
            califs.push({ inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trimestres[t].id, promedioTrimestral: nota })
            // Asistencia del trimestre (resumen): clases = horas/semana × 11 semanas
            const clases = HORAS[d.codigo] * 11
            const pct = pctAsistencia(s.gi, hace) + (t === 2 ? 0.8 : 0)
            const faltas = Math.round(clases * (1 - clamp(pct, 0, 100) / 100))
            const justificado = Math.round(faltas * 0.25)
            const retraso = Math.round(clases * 0.03)
            const ausente = Math.max(0, faltas - justificado)
            const presente = Math.max(0, clases - ausente - justificado - retraso)
            resumenes.push({
              inscripcionId: insc.id, docenteMateriaCursoId: d.id, trimestreId: trimestres[t].id, totalClases: clases,
              totalPresente: presente, totalAusente: ausente, totalRetraso: retraso, totalJustificado: justificado,
              porcentaje: redondea(((presente + justificado) / clases) * 100),
            })
          }
          if (s.trimestresCursados === 3) {
            const prom = redondea(notas.reduce((a, b) => a + b, 0) / 3)
            if (prom < 51) aprueba = false
            finales.push({ inscripcionId: insc.id, docenteMateriaCursoId: d.id, promedioFinal: prom, resultado: prom >= 51 ? 'PROMOVIDO' : 'REPROBADO' })
          }
        })
        if (s.trimestresCursados === 3) resultados.push({ id: insc.id, resultado: aprueba ? 'PROMOVIDO' : 'REPROBADO' })
      })

      await insertar(califs, 5000, l => c.calificacion.createMany({ data: l }))
      await insertar(finales, 5000, l => c.promedioFinal.createMany({ data: l }))
      await insertar(resumenes, 5000, l => c.resumenAsistencia.createMany({ data: l }))
      for (const res of ['PROMOVIDO', 'REPROBADO'] as const) {
        const ids = resultados.filter(r => r.resultado === res).map(r => r.id)
        await insertar(ids, 5000, l => c.inscripcion.updateMany({ where: { id: { in: l } }, data: { resultado: res } }))
      }
      resumenAnios.push(`${anio}: ${inscripciones.length} inscritos, ${resultados.filter(r => r.resultado === 'REPROBADO').length} reprobados, ${conCurso.filter(x => x.s.estado === 'RETIRO').length} retirados`)
      paso(`gestión ${anio} cerrada: ${inscripciones.length} inscripciones, ${califs.length} calificaciones, ${finales.length} promedios finales, ${resumenes.length} resúmenes de asistencia`)
    }

    // 6) Verificación
    console.log('\nVerificación (histórico):')
    const v = ctx.verificar
    for (const anio of [Y2, Y1]) {
      const g = await c.gestion.findUniqueOrThrow({ where: { anio } })
      const tot = await c.inscripcion.count({ where: { gestionId: g.id } })
      const rep = await c.inscripcion.count({ where: { gestionId: g.id, resultado: 'REPROBADO' } })
      const pro = await c.inscripcion.count({ where: { gestionId: g.id, resultado: 'PROMOVIDO' } })
      const ret = await c.inscripcion.count({ where: { gestionId: g.id, estadoInscripcion: 'RETIRADA' } })
      v(!g.activa && (await c.trimestre.count({ where: { gestionId: g.id, cerrado: true } })) === 3, `${anio}: gestión inactiva con los 3 trimestres cerrados`)
      v(tot > 800 && pro + rep + ret === tot, `${anio}: ${tot} inscritos = ${pro} promovidos + ${rep} reprobados + ${ret} retirados`)
      const tasa = (pro / (pro + rep)) * 100
      v(tasa > 85 && tasa < 97, `${anio}: tasa de aprobación realista (${tasa.toFixed(1)} %)`)
    }
    // un estudiante de 4.° de la gestión actual debe tener 3 gestiones consecutivas
    const ejemplo = await c.inscripcion.findFirst({
      where: { gestion: { anio: ctx.ANIO }, curso: { grado: 5 }, estudiante: { persona: { ci: { startsWith: 'V' } } } },
      orderBy: { id: 'asc' }, select: { estudianteId: true },
    })
    const trayectoria = await c.inscripcion.findMany({ where: { estudianteId: ejemplo!.estudianteId }, orderBy: { gestion: { anio: 'asc' } }, select: { gestion: { select: { anio: true } }, curso: { select: { grado: true } }, resultado: true } })
    v(trayectoria.length >= 2, `trayectoria de un estudiante de 5.°: ${trayectoria.map(t => `${t.gestion.anio} ${t.curso.grado}°(${t.resultado})`).join(' → ')}`)
    const promediosPorAnio = await c.$queryRaw<{ anio: number; promedio: number }[]>`
      SELECT g.anio, AVG(pf."promedioFinal")::float AS promedio FROM "PromedioFinal" pf
      JOIN "Inscripcion" i ON i.id = pf."inscripcionId" JOIN "Gestion" g ON g.id = i."gestionId" GROUP BY g.anio ORDER BY g.anio`
    v(promediosPorAnio.length === 2 && promediosPorAnio[1].promedio > promediosPorAnio[0].promedio,
      `el promedio mejora año a año (${promediosPorAnio.map(p => `${p.anio}: ${p.promedio.toFixed(1)}`).join(' → ')})`)
    const ids = await c.docenteMateriaCurso.count()
    v(ids === 24 * MATERIAS_DICTADAS.length * 3, `${ids} asignaciones docente-materia-curso (3 gestiones)`)

    console.log('\nRESUMEN:')
    resumenAnios.forEach(r => console.log(`  ${r}`))
    console.log('\nPRUEBAS SUGERIDAS: Historial académico (busca un estudiante con CI V00600: 3 gestiones; E00001: egresado) · '
      + 'Reportes → Comparativo entre gestiones · Boletín/Libreta de una gestión pasada · Promoción de la gestión actual.')
  },
}