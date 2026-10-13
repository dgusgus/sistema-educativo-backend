// prisma/seeds/volumen.ts
//
// PERFIL "volumen": un colegio con ~900 estudiantes registrados.
//   • 900 estudiantes (registros permanentes); 360 inscritos este año (12 cursos × 30)
//     y 540 sin inscripción este año (antiguos), para ver la lista tal como será en producción
//   • Notas de los 3 trimestres cargadas (T1-T2 cerrados, T3 abierto) → listo también para probar el CIERRE
//   • 40 estudiantes con cuenta (est_v001..est_v040 / est1234)
//   • Gestión siguiente inactiva y VACÍA → probar "Copiar estructura" con volumen real
//
// Para qué: medir paginación, búsqueda, tiempos de carga de listas, reportes y boletines
// con datos del tamaño real. Tarda ~10-20 s en sembrarse.
import {
  crearDirector, crearSecretaria, crearDocentes, crearGestion, crearDimensiones, crearConceptosPago,
  crearCursos, asignarMaterias, crearEstudiantes, ponerNotas, mesRel, mostrarCredenciales,
  type Perfil, type PerfilNotas, type InscripcionNotas,
} from './_comun.js'

const TOTAL = 900
const POR_CURSO = 30

const perfilDe = (i: number): PerfilNotas => (i % 20 === 0 ? 'REPRUEBA_MAT' : i % 3 === 0 ? 'ALTO' : 'MEDIO')

export const volumen: Perfil = {
  descripcion: '~900 estudiantes (360 inscritos, 540 sin inscripción este año), notas completas, 40 cuentas.',
  async sembrar(ctx) {
    const c = ctx.prisma
    const director = await crearDirector(ctx)
    await crearSecretaria(ctx)
    const docentes = await crearDocentes(ctx, 8)

    const actual = await crearGestion(ctx, {
      anio: ctx.ANIO, activa: true, descripcion: `Gestión Escolar ${ctx.ANIO} (volumen)`, directorId: director.id,
      meses: [mesRel(ctx.ANCLA, -2), mesRel(ctx.ANCLA, -1), mesRel(ctx.ANCLA, 0)], cerrados: [true, true, false],
    })
    const siguiente = await crearGestion(ctx, {
      anio: ctx.ANIO + 1, activa: false, descripcion: `Gestión Escolar ${ctx.ANIO + 1} (vacía)`, directorId: director.id,
      meses: [mesRel(ctx.ANCLA, 1), mesRel(ctx.ANCLA, 2), mesRel(ctx.ANCLA, 3)], cerrados: [false, false, false],
    })
    await crearDimensiones(ctx, actual.gestion.id)
    await crearDimensiones(ctx, siguiente.gestion.id)
    await crearConceptosPago(ctx, actual.gestion.id)

    const cursos = await crearCursos(ctx, actual.gestion.id, [1, 2, 3, 4, 5, 6], ['A', 'B'])
    const asig = await asignarMaterias(ctx, actual.gestion.id, cursos, docentes)

    const estudiantes = await crearEstudiantes(ctx, TOTAL, { prefijoCi: 'V', conCuenta: 40 })

    // Los primeros 360 se inscriben (30 por curso); el resto queda sin inscripción este año.
    const inscribibles = estudiantes.slice(0, cursos.length * POR_CURSO)
    const inscripciones = await c.inscripcion.createManyAndReturn({
      data: inscribibles.map((e, n) => ({ estudianteId: e.estudianteId, cursoId: cursos[Math.floor(n / POR_CURSO)].id, gestionId: actual.gestion.id })),
    })
    const filas: InscripcionNotas[] = inscripciones.map((insc, n) => ({
      inscripcionId: insc.id, idx: inscribibles[n].i, perfil: perfilDe(inscribibles[n].i), asignaciones: asig.get(insc.cursoId)!,
    }))
    await ponerNotas(ctx, actual.trimestres, filas)

    console.log('\nVerificación:')
    ctx.verificar((await c.estudiante.count()) === TOTAL, `${TOTAL} estudiantes registrados`)
    ctx.verificar((await c.inscripcion.count({ where: { gestionId: actual.gestion.id } })) === cursos.length * POR_CURSO, `${cursos.length * POR_CURSO} inscritos este año`)
    ctx.verificar((await c.usuario.count({ where: { roles: { has: 'ESTUDIANTE' } } })) === 40, '40 cuentas de estudiante')
    ctx.verificar((await c.calificacion.count()) === cursos.length * POR_CURSO * 8 * 3, 'notas T1-T3 de las 8 materias de cada inscrito')
    ctx.verificar((await c.curso.count({ where: { gestionId: siguiente.gestion.id } })) === 0, 'gestión siguiente vacía (para probar Copiar estructura)')

    mostrarCredenciales(['director / admin1234 · secretaria / sec1234 · doc01..doc08 / doc1234 · est_v001..est_v040 / est1234'])
    console.log('\nPRUEBAS SUGERIDAS: Estudiantes (paginación y búsqueda, "Ana Condori", CI "V00450") · Gestiones → Copiar estructura · Boletines y Reportes por curso.')
  },
}
