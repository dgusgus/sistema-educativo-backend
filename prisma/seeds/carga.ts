// prisma/seeds/carga.ts
//
// PERFIL "carga": el colegio al TAMAÑO MÁXIMO previsto — 900 estudiantes INSCRITOS este año.
//   • 24 cursos (1°-6° × paralelos A, B, C, D), 37-38 estudiantes por curso (capacidad 40)
//   • 37 docentes con cuenta (doc01..doc37), 8 materias por curso = 192 asignaciones
//   • Horarios completos de los 24 cursos, sin choques de docente ni de curso
//   • Trimestres mensuales: T1 y T2 cerrados, T3 abierto y 100 % calificado (se puede probar el CIERRE)
//   • Notas reales por actividad (4 dimensiones × 3 trimestres): NotaActividad → Calificacion → dimensiones
//   • Asistencia por clase según el horario de cada materia (T1-T3) + resúmenes
//   • ~770 tutores (hermanos comparten tutor), pagos con PAGADO / PARCIAL / PENDIENTE / ANULADO / sin pagar
//   • Casos límite: retirados, reprobados en Matemáticas, ~10 % con asistencia crítica (alertas)
//   • Gestión siguiente inactiva y VACÍA → probar "Copiar estructura" y Promoción con volumen real
//
// Cuentas (solo desarrollo): director / admin1234 · secretaria / sec1234 · doc01..doc37 / doc1234
//   · est_v001..est_v060 / est1234 · tut_v001..tut_v030 / tut1234
//
// Para qué: paginación, búsqueda, boletines masivos, reportes, dashboard, cierre de trimestre y
// promoción con el volumen real. Tarda ~1-2 min en sembrarse (~600.000 filas). Determinista.
import bcrypt from 'bcryptjs'
import {
  crearDirector, crearSecretaria, crearDocentes, crearGestion, crearDimensiones, crearConceptosPago,
  crearCursos, crearEstudiantes, mesRel, mostrarCredenciales, ultimoDia, utc, nombreDe, apellidoDe,
  MATERIAS_DICTADAS, type Perfil,
} from './_comun.js'
import { MATERIAS } from '../seed.catalogo.js'

const TOTAL = 900
const PARALELOS = ['A', 'B', 'C', 'D']
const GRADOS = [1, 2, 3, 4, 5, 6]
const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES'] as const
const DIA_UTC: Record<(typeof DIAS)[number], number> = { LUNES: 1, MARTES: 2, MIERCOLES: 3, JUEVES: 4, VIERNES: 5 }
const PERIODOS: Array<[string, string]> = [['08:00', '08:45'], ['08:45', '09:30'], ['09:30', '10:15'], ['10:30', '11:15'], ['11:15', '12:00'], ['12:00', '12:45']]
const hora = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`)
const HORAS: Record<string, number> = Object.fromEntries(MATERIAS.map(m => [m.codigo, m.horas]))
const OCUPACIONES = ['Comerciante', 'Chofer', 'Costurera', 'Albañil', 'Enfermera', 'Agricultor', 'Artesana', 'Mecánico']
const MOTIVOS = ['Certificado médico', 'Permiso familiar', 'Trámite de documentos', 'Cita de control']
const DIM = [
  { nombre: 'Ser', max: 5, peso: 5 }, { nombre: 'Saber', max: 100, peso: 45 },
  { nombre: 'Hacer', max: 100, peso: 40 }, { nombre: 'Decidir', max: 100, peso: 10 },
] as const
const ACT_NOMBRE: Record<string, string> = { Ser: 'Autoevaluación de valores', Saber: 'Examen escrito', Hacer: 'Trabajo práctico', Decidir: 'Participación y proyecto' }

const redondea = (n: number) => Math.round(n * 100) / 100
async function insertar<T>(filas: T[], tam: number, fn: (lote: T[]) => Promise<unknown>) {
  for (let i = 0; i < filas.length; i += tam) await fn(filas.slice(i, i + tam))
}

/** Fracción de nota (0-1) de un estudiante: determinista, 0.55-0.94; ~5 % reprueba Matemáticas. */
const fraccion = (gi: number, trim: number, salt: number, esMat: boolean): number => {
  if (esMat && gi % 20 === 0) return 0.35 + ((gi + trim) % 8) / 100
  return redondea(0.55 + ((gi * (37 + trim * 16 + salt)) % 40) / 100)
}

/** Perfil de asistencia: ~60 % impecable, ~20 % regular, ~10 % irregular (~70 %), ~10 % crítico (~50 %). */
function estadoAsistencia(gi: number, di: number): 'PRESENTE' | 'AUSENTE' | 'RETRASO' {
  const r = gi % 10
  if (r <= 5) return (di + gi) % 29 === 0 ? 'RETRASO' : 'PRESENTE'
  if (r <= 7) return (di + gi) % 23 === 0 ? 'RETRASO' : (di + gi) % 11 === 0 ? 'AUSENTE' : 'PRESENTE'
  if (r === 8) return (di * 3 + gi) % 10 < 7 ? 'PRESENTE' : 'AUSENTE'
  return (di + gi * 2) % 10 < 5 ? 'PRESENTE' : 'AUSENTE'
}

export const carga: Perfil = {
  descripcion: '900 inscritos en 24 cursos (A-D), 37 docentes, horarios, notas por actividad, asistencia, tutores y pagos.',
  async sembrar(ctx) {
    const c = ctx.prisma
    const t0 = Date.now()
    const paso = (m: string) => console.log(`✓ ${m} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)

    // ── Personal y estructura ─────────────────────────────────────────────
    const director = await crearDirector(ctx)
    await crearSecretaria(ctx)

    const mesesT = [mesRel(ctx.ANCLA, -2), mesRel(ctx.ANCLA, -1), mesRel(ctx.ANCLA, 0)] as const
    const actual = await crearGestion(ctx, {
      anio: ctx.ANIO, activa: true, descripcion: `Gestión Escolar ${ctx.ANIO} (carga 900)`, directorId: director.id,
      meses: [mesesT[0], mesesT[1], mesesT[2]], cerrados: [true, true, false],
    })
    const siguiente = await crearGestion(ctx, {
      anio: ctx.ANIO + 1, activa: false, descripcion: `Gestión Escolar ${ctx.ANIO + 1} (vacía)`, directorId: director.id,
      meses: [mesRel(ctx.ANCLA, 1), mesRel(ctx.ANCLA, 2), mesRel(ctx.ANCLA, 3)], cerrados: [false, false, false],
    })
    const gestionId = actual.gestion.id
    await crearDimensiones(ctx, gestionId)
    await crearDimensiones(ctx, siguiente.gestion.id)
    await crearConceptosPago(ctx, gestionId)
    const dims = await c.dimensionEvaluacion.findMany({ where: { gestionId } })
    const dimId = new Map(dims.map(d => [d.nombre, d.id]))

    const cursos = await crearCursos(ctx, gestionId, GRADOS, PARALELOS)   // 24 cursos
    // Reparto de docentes: materia con h horas → h+1 docentes (≈ 18-20 h/semana cada uno, margen para armar horarios sin choques).
    const pools = MATERIAS_DICTADAS.map(cod => HORAS[cod] + 1)
    const nDocentes = pools.reduce((s, h) => s + h, 0)
    const docentes = await crearDocentes(ctx, nDocentes)
    const inicioPool: number[] = []
    pools.reduce((acc, h, i) => { inicioPool[i] = acc; return acc + h }, 0)
    const dmcData = cursos.flatMap((cu, ci) => MATERIAS_DICTADAS.map((cod, mi) => ({
      gestionId, cursoId: cu.id, materiaId: ctx.materias[cod].id, docenteId: docentes[inicioPool[mi] + (ci % pools[mi])].id,
    })))
    const dmcFilas = await c.docenteMateriaCurso.createManyAndReturn({ data: dmcData })
    const codDeMateria = new Map(MATERIAS_DICTADAS.map(cod => [ctx.materias[cod].id, cod]))
    const dmcs = dmcFilas.map(f => ({ id: f.id, cursoId: f.cursoId, docenteId: f.docenteId, codigo: codDeMateria.get(f.materiaId)! }))
    const dmcsDeCurso = new Map<number, typeof dmcs>()
    for (const d of dmcs) dmcsDeCurso.set(d.cursoId, [...(dmcsDeCurso.get(d.cursoId) ?? []), d])
    paso(`${cursos.length} cursos, ${docentes.length} docentes, ${dmcs.length} asignaciones`)

    // ── Horarios (voraz, sin choques de docente ni de curso) ──────────────
    const docOcupado = new Set<string>()
    const bloques: { docenteMateriaCursoId: number; diaSemana: (typeof DIAS)[number]; horaInicio: Date; horaFin: Date; aula: string }[] = []
    const diasDeDmc = new Map<number, Set<number>>()   // dmc → días de la semana (getUTCDay) en que hay clase
    cursos.forEach((cu, ci) => {
      // Se prueban varios órdenes de recorrido de los 30 huecos semanales hasta que el curso quede completo.
      for (let intento = 0; intento < 60; intento++) {
        const pend = (dmcsDeCurso.get(cu.id) ?? []).map(d => ({ d, restante: HORAS[d.codigo], porDia: new Map<number, number>() }))
        const lleno = new Set<string>()
        const nuevosOcupados: string[] = []
        const nuevosBloques: typeof bloques = []
        const huecos = Array.from({ length: PERIODOS.length * DIAS.length }, (_, n) => n)
        const desp = (ci * 7 + intento * 11) % huecos.length
        const orden = [...huecos.slice(desp), ...huecos.slice(0, desp)]
        const colocar = (maxPorDia: number) => {
          for (const h of orden) {
            const p = Math.floor(h / DIAS.length), di = h % DIAS.length
            if (lleno.has(`${di}|${p}`)) continue
            const x = pend
              .filter(q => q.restante > 0 && (q.porDia.get(di) ?? 0) < maxPorDia && !docOcupado.has(`${q.d.docenteId}|${di}|${p}`) && !nuevosOcupados.includes(`${q.d.docenteId}|${di}|${p}`))
              .sort((a, b) => b.restante - a.restante || ((a.d.id + di + p + intento) % 7) - ((b.d.id + di + p + intento) % 7))[0]
            if (!x) continue
            x.restante--; x.porDia.set(di, (x.porDia.get(di) ?? 0) + 1)
            lleno.add(`${di}|${p}`); nuevosOcupados.push(`${x.d.docenteId}|${di}|${p}`)
            nuevosBloques.push({ docenteMateriaCursoId: x.d.id, diaSemana: DIAS[di], horaInicio: hora(PERIODOS[p][0]), horaFin: hora(PERIODOS[p][1]), aula: `Aula ${cu.grado}°${cu.paralelo}` })
          }
        }
        colocar(2); colocar(5)
        if (pend.some(q => q.restante > 0)) {
          if (intento === 59) throw new Error(`No se pudo armar el horario de ${cu.grado}°${cu.paralelo}: faltan horas de ${pend.filter(q => q.restante > 0).map(f => f.d.codigo).join(', ')}`)
          continue
        }
        nuevosOcupados.forEach(k => docOcupado.add(k))
        for (const b of nuevosBloques) {
          bloques.push(b)
          diasDeDmc.set(b.docenteMateriaCursoId, (diasDeDmc.get(b.docenteMateriaCursoId) ?? new Set()).add(DIA_UTC[b.diaSemana]))
        }
        return
      }
    })
    await insertar(bloques, 2000, lote => c.horario.createMany({ data: lote }))
    paso(`${bloques.length} bloques de horario`)

    // ── Estudiantes, inscripciones, RUDE ──────────────────────────────────
    const estudiantes = await crearEstudiantes(ctx, TOTAL, { prefijoCi: 'V', conCuenta: 60 })
    await c.$executeRawUnsafe(`UPDATE "Estudiante" SET rude = 'R${ctx.ANIO}' || LPAD(id::text, 5, '0') WHERE rude IS NULL`)
    // 37 por curso + 1 extra a los primeros 12 cursos = 900
    const tam = (ci: number) => 37 + (ci < TOTAL - 37 * cursos.length ? 1 : 0)
    const asignacionCurso: number[] = []
    cursos.forEach((_, ci) => { for (let k = 0; k < tam(ci); k++) asignacionCurso.push(ci) })
    const RETIRADO = (i: number) => i % 60 === 17      // ~15 retirados (caso límite)
    const fechaIns = utc(mesesT[0].y, mesesT[0].m, 1)
    const inscripciones = await c.inscripcion.createManyAndReturn({
      data: estudiantes.map((e, n) => ({
        estudianteId: e.estudianteId, cursoId: cursos[asignacionCurso[n]].id, gestionId, fechaInscripcion: fechaIns,
        ...(RETIRADO(e.i) ? { estadoInscripcion: 'RETIRADA' as const, fechaRetiro: utc(mesesT[1].y, mesesT[1].m, 10), observaciones: 'Cambio de domicilio' } : {}),
      })),
    })
    const filas = inscripciones.map((insc, n) => ({ insc, gi: estudiantes[n].i, estudianteId: estudiantes[n].estudianteId, retirado: RETIRADO(estudiantes[n].i) }))
    paso(`${filas.length} inscripciones (${filas.filter(f => f.retirado).length} retiradas)`)

    // ── Tutores (hermanos comparten tutor: cada 7.º estudiante) ───────────
    const hashTut = await bcrypt.hash('tut1234', 4)
    const principales = filas.filter((_, n) => n % 7 !== 6)
    const tPersonas = await c.persona.createManyAndReturn({
      data: principales.map((f, n) => ({ ci: `T${String(n + 1).padStart(5, '0')}`, nombre: nombreDe(n * 3 + 1), apellido: apellidoDe(n * 7 + 2), telefono: `79${String(100000 + n)}` })),
    })
    const tutores = await c.tutor.createManyAndReturn({ data: tPersonas.map((p, n) => ({ personaId: p.id, ocupacion: OCUPACIONES[n % OCUPACIONES.length] })) })
    for (let n = 0; n < 30; n++) {
      const u = await c.usuario.create({ data: { username: `tut_v${String(n + 1).padStart(3, '0')}`, passwordHash: hashTut, roles: ['TUTOR'] } })
      await c.tutor.update({ where: { id: tutores[n].id }, data: { usuarioId: u.id } })
    }
    const vinculos: { tutorId: number; estudianteId: number; parentesco: 'MADRE' | 'PADRE'; esTutorPrincipal: boolean; esApoderado: boolean }[] = []
    let k = 0
    filas.forEach((f, n) => {
      if (n % 7 === 6) {   // hermano: comparte el tutor del estudiante anterior
        vinculos.push({ tutorId: tutores[Math.max(0, k - 1)].id, estudianteId: f.estudianteId, parentesco: 'MADRE', esTutorPrincipal: false, esApoderado: false })
      } else {
        vinculos.push({ tutorId: tutores[k].id, estudianteId: f.estudianteId, parentesco: k % 2 ? 'MADRE' : 'PADRE', esTutorPrincipal: true, esApoderado: true }); k++
      }
    })
    await insertar(vinculos, 2000, lote => c.tutorEstudiante.createMany({ data: lote }))
    paso(`${tutores.length} tutores, ${vinculos.length} vínculos`)

    // ── Actividades y notas (fuente de verdad) + calificaciones ───────────
    const trims = actual.trimestres
    const actData = dmcs.flatMap(d => trims.flatMap(t => DIM.map(dm => ({
      docenteMateriaCursoId: d.id, trimestreId: t.id, dimensionId: dimId.get(dm.nombre)!, nombre: ACT_NOMBRE[dm.nombre],
      puntajeMaximo: dm.max, peso: 1, fecha: new Date(t.fechaInicio.getTime() + 14 * 86400000),
    }))))
    const actFilas: { id: number; docenteMateriaCursoId: number; trimestreId: number; dimensionId: number }[] = []
    await insertar(actData, 2000, async lote => { actFilas.push(...await c.actividadEvaluativa.createManyAndReturn({ data: lote, select: { id: true, docenteMateriaCursoId: true, trimestreId: true, dimensionId: true } })) })
    const actId = new Map(actFilas.map(a => [`${a.docenteMateriaCursoId}-${a.trimestreId}-${a.dimensionId}`, a.id]))

    const porCurso = new Map<number, typeof filas>()
    for (const f of filas) porCurso.set(f.insc.cursoId, [...(porCurso.get(f.insc.cursoId) ?? []), f])
    const notas: { actividadEvaluativaId: number; inscripcionId: number; nota: number }[] = []
    const califs: { inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; promedioTrimestral: number }[] = []
    const califDim: { clave: string; dimensionId: number; promedio: number }[] = []
    for (const d of dmcs) {
      for (let ti = 0; ti < trims.length; ti++) {
        for (const f of porCurso.get(d.cursoId) ?? []) {
          if (f.retirado && ti > 0) continue          // el retirado solo tiene T1
          const fr = fraccion(f.gi, ti + 1, d.id % 5, d.codigo === 'MAT')
          for (const dm of DIM) {
            notas.push({ actividadEvaluativaId: actId.get(`${d.id}-${trims[ti].id}-${dimId.get(dm.nombre)}`)!, inscripcionId: f.insc.id, nota: redondea(dm.max * fr) })
            califDim.push({ clave: `${f.insc.id}-${d.id}-${trims[ti].id}`, dimensionId: dimId.get(dm.nombre)!, promedio: redondea(fr * dm.peso) })
          }
          califs.push({ inscripcionId: f.insc.id, docenteMateriaCursoId: d.id, trimestreId: trims[ti].id, promedioTrimestral: redondea(fr * 100) })
        }
      }
    }
    await insertar(notas, 5000, lote => c.notaActividad.createMany({ data: lote }))
    paso(`${actFilas.length} actividades, ${notas.length} notas`)
    const calFilas: { id: number; inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number }[] = []
    await insertar(califs, 5000, async lote => { calFilas.push(...await c.calificacion.createManyAndReturn({ data: lote, select: { id: true, inscripcionId: true, docenteMateriaCursoId: true, trimestreId: true } })) })
    const calId = new Map(calFilas.map(x => [`${x.inscripcionId}-${x.docenteMateriaCursoId}-${x.trimestreId}`, x.id]))
    await insertar(califDim, 5000, lote => c.calificacionDimension.createMany({ data: lote.map(x => ({ calificacionId: calId.get(x.clave)!, dimensionId: x.dimensionId, promedio: x.promedio })) }))
    paso(`${calFilas.length} calificaciones, ${califDim.length} por dimensión`)

    // Un caso de corrección con historial (para probar la pantalla de historial)
    const cal0 = calFilas[0]
    await c.historialCalificacion.create({
      data: { calificacionId: cal0.id, promedioAnterior: 45, promedioNuevo: 50, motivo: 'Revisión de prueba de recuperación', usuarioId: (await c.usuario.findFirstOrThrow({ where: { username: 'director' } })).id },
    })

    // ── Asistencia por clase (según horario) + resúmenes ──────────────────
    type Est = 'PRESENTE' | 'AUSENTE' | 'RETRASO' | 'JUSTIFICADO'
    const resumen = new Map<string, { p: number; a: number; r: number; j: number; t: number; insc: number; dmc: number; trim: number }>()
    let nAsis = 0
    for (const d of dmcs) {
      const diasSem = diasDeDmc.get(d.id) ?? new Set<number>()
      for (let ti = 0; ti < trims.length; ti++) {
        const { y, m } = mesesT[ti]
        const fechas: Date[] = []
        for (let dd = 1; dd <= ultimoDia(y, m); dd++) {
          const f = utc(y, m, dd)
          if (diasSem.has(f.getUTCDay()) && f.getTime() <= ctx.ANCLA.getTime()) fechas.push(f)
        }
        const lote: { inscripcionId: number; docenteMateriaCursoId: number; trimestreId: number; fecha: Date; estado: Est; justificacion?: string }[] = []
        for (const f of porCurso.get(d.cursoId) ?? []) {
          if (f.retirado && ti > 0) continue
          const r = { p: 0, a: 0, r: 0, j: 0, t: 0, insc: f.insc.id, dmc: d.id, trim: trims[ti].id }
          fechas.forEach((fecha, di) => {
            let estado: Est = estadoAsistencia(f.gi, di)
            let justificacion: string | undefined
            if (estado === 'AUSENTE' && (di + f.gi) % 4 === 0) { estado = 'JUSTIFICADO'; justificacion = MOTIVOS[(di + f.gi) % MOTIVOS.length] }
            lote.push({ inscripcionId: f.insc.id, docenteMateriaCursoId: d.id, trimestreId: trims[ti].id, fecha, estado, ...(justificacion ? { justificacion } : {}) })
            r.t++; if (estado === 'PRESENTE') r.p++; else if (estado === 'AUSENTE') r.a++; else if (estado === 'JUSTIFICADO') r.j++; else r.r++
          })
          if (r.t) resumen.set(`${f.insc.id}-${d.id}-${trims[ti].id}`, r)
        }
        nAsis += lote.length
        await insertar(lote, 4000, l => c.asistencia.createMany({ data: l }))
      }
    }
    await insertar([...resumen.values()], 4000, lote => c.resumenAsistencia.createMany({
      data: lote.map(g => ({
        inscripcionId: g.insc, docenteMateriaCursoId: g.dmc, trimestreId: g.trim, totalClases: g.t, totalPresente: g.p,
        totalAusente: g.a, totalRetraso: g.r, totalJustificado: g.j, porcentaje: redondea(((g.p + g.j) / g.t) * 100),
      })),
    }))
    paso(`${nAsis} asistencias, ${resumen.size} resúmenes`)

    // ── Pagos ─────────────────────────────────────────────────────────────
    const conceptos = await c.conceptoPago.findMany({ where: { gestionId }, orderBy: { id: 'asc' } })
    const [cMat, cMen, cMaterial] = conceptos
    const secretaria = await c.usuario.findFirstOrThrow({ where: { username: 'secretaria' } })
    let rec = 1
    const recibo = () => `REC-${ctx.ANIO}-${String(rec++).padStart(4, '0')}`
    const fechaPago = utc(mesesT[0].y, mesesT[0].m, 5)
    type PagoFila = { inscripcionId: number; conceptoPagoId: number; montoOriginal: number; montoPagado: number; metodoPago: 'EFECTIVO' | 'TRANSFERENCIA' | 'QR'; estado: 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'ANULADO'; numeroRecibo: string; registradoPorId: number; fechaPago: Date }
    const pagos: PagoFila[] = []
    const mk = (f: (typeof filas)[number], cp: typeof cMat, pagado: number, estado: PagoFila['estado'], metodo: PagoFila['metodoPago'] = 'EFECTIVO') =>
      pagos.push({ inscripcionId: f.insc.id, conceptoPagoId: cp.id, montoOriginal: Number(cp.monto), montoPagado: pagado, metodoPago: metodo, estado, numeroRecibo: recibo(), registradoPorId: secretaria.id, fechaPago })
    for (const f of filas) {
      if (f.retirado) { mk(f, cMat, Number(cMat.monto), 'ANULADO'); continue }
      const r = f.gi % 10
      if (r === 9) continue                                      // 10 % sin pagar nada
      if (r === 8) { mk(f, cMat, 60, 'PARCIAL', 'TRANSFERENCIA'); continue }
      if (r === 7 && f.gi % 3 === 0) { mk(f, cMat, 0, 'PENDIENTE'); continue }
      mk(f, cMat, Number(cMat.monto), 'PAGADO')
      mk(f, cMen, Number(cMen.monto), 'PAGADO', f.gi % 2 ? 'QR' : 'EFECTIVO')
      if (f.gi % 3 === 0) mk(f, cMaterial, Number(cMaterial.monto), 'PAGADO', 'TRANSFERENCIA')
    }
    await insertar(pagos, 2000, lote => c.pago.createMany({ data: lote }))
    paso(`${pagos.length} pagos`)

    // ── Verificación ──────────────────────────────────────────────────────
    console.log('\nVerificación:')
    const v = ctx.verificar
    v((await c.inscripcion.count({ where: { gestionId } })) === TOTAL, `${TOTAL} inscritos este año`)
    v((await c.curso.count({ where: { gestionId } })) === 24, '24 cursos (6 grados × A, B, C, D)')
    const mayor = await c.curso.findMany({ where: { gestionId }, select: { capacidad: true, _count: { select: { inscripciones: true } } } })
    v(mayor.every(x => x._count.inscripciones <= (x.capacidad ?? 40)), 'ningún curso supera su capacidad (40)')
    v((await c.docenteMateriaCurso.count()) === 24 * MATERIAS_DICTADAS.length, `${24 * MATERIAS_DICTADAS.length} asignaciones docente-materia-curso`)
    const choques = await c.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "Horario" a
      JOIN "DocenteMateriaCurso" da ON da.id = a."docenteMateriaCursoId"
      JOIN "Horario" b ON b.id > a.id AND b."diaSemana" = a."diaSemana" AND a."horaInicio" < b."horaFin" AND b."horaInicio" < a."horaFin"
      JOIN "DocenteMateriaCurso" db ON db.id = b."docenteMateriaCursoId"
      WHERE da."docenteId" = db."docenteId" OR da."cursoId" = db."cursoId"`
    v(Number(choques[0].n) === 0, 'sin choques de horario (docente ni curso)')
    v((await c.asistencia.count()) === nAsis && nAsis > 0, `${nAsis} registros de asistencia`)
    v((await c.promedioFinal.count()) === 0, 'PromedioFinal vacío (nace al cerrar T3)')
    v((await c.trimestre.count({ where: { gestionId, cerrado: true } })) === 2, 'T1 y T2 cerrados, T3 abierto')

    mostrarCredenciales([
      'director / admin1234 · secretaria / sec1234',
      `doc01..doc${docentes.length} / doc1234 · est_v001..est_v060 / est1234 · tut_v001..tut_v030 / tut1234`,
    ])
    console.log('\nPRUEBAS SUGERIDAS: Estudiantes (paginación, búsqueda "V00450", RUDE) · Boletín masivo por curso · Dashboard y alertas de asistencia · '
      + 'Cerrar T3 (900 × 8 materias) · Promoción · Gestiones → Copiar estructura · Pagos (REC-' + ctx.ANIO + '-####).')
  },
}