// prisma/seeds/estructura.ts
//
// PERFIL "estructura": el colegio ARMADO pero SIN estudiantes.
//   • director + secretaria + 8 docentes con cuenta
//   • gestión del año ACTIVA, 3 trimestres mensuales abiertos, 4 dimensiones (Ser/Saber/Hacer/Decidir)
//   • 12 cursos (1°-6° × A/B), cada uno con sus 8 materias asignadas a un docente
//   • 3 conceptos de pago
//
// Para qué: probar lo que viene DESPUÉS de montar la estructura — inscribir uno a uno,
// importar estudiantes desde Excel, cargar notas y asistencia desde cero, registrar pagos.
import {
  crearDirector, crearSecretaria, crearDocentes, crearGestion, crearDimensiones, crearConceptosPago,
  crearCursos, asignarMaterias, mesRel, mostrarCredenciales, MATERIAS_DICTADAS, type Perfil,
} from './_comun.js'

export const estructura: Perfil = {
  descripcion: 'Colegio armado (gestión, 12 cursos, 8 docentes, asignaciones, pagos) sin estudiantes.',
  async sembrar(ctx) {
    const director = await crearDirector(ctx)
    await crearSecretaria(ctx)
    const docentes = await crearDocentes(ctx, 8)

    const { gestion } = await crearGestion(ctx, {
      anio: ctx.ANIO, activa: true, descripcion: `Gestión Escolar ${ctx.ANIO}`, directorId: director.id,
      meses: [mesRel(ctx.ANCLA, -1), mesRel(ctx.ANCLA, 0), mesRel(ctx.ANCLA, 1)], cerrados: [false, false, false],
    })
    await crearDimensiones(ctx, gestion.id)
    await crearConceptosPago(ctx, gestion.id)
    const cursos = await crearCursos(ctx, gestion.id, [1, 2, 3, 4, 5, 6], ['A', 'B'])
    await asignarMaterias(ctx, gestion.id, cursos, docentes)

    console.log('\nVerificación:')
    const c = ctx.prisma
    ctx.verificar((await c.gestion.count({ where: { activa: true } })) === 1, 'exactamente una gestión activa')
    ctx.verificar((await c.curso.count()) === 12, '12 cursos')
    ctx.verificar((await c.docenteMateriaCurso.count()) === 12 * MATERIAS_DICTADAS.length, `${12 * MATERIAS_DICTADAS.length} asignaciones docente-materia-curso`)
    ctx.verificar((await c.trimestre.count({ where: { cerrado: false } })) === 3, '3 trimestres abiertos')
    ctx.verificar((await c.estudiante.count()) === 0, 'sin estudiantes')
    const sumaPesos = await c.dimensionEvaluacion.aggregate({ where: { gestionId: gestion.id }, _sum: { pesoEnPromedio: true } })
    ctx.verificar(Number(sumaPesos._sum.pesoEnPromedio) === 1, 'pesos de las dimensiones suman 100 %')

    mostrarCredenciales(['director / admin1234', 'secretaria / sec1234', 'doc01..doc08 / doc1234'])
    console.log('\nSIGUIENTE PASO: Estudiantes → Importar (Excel) o inscribir uno a uno · Calificaciones desde cero.')
  },
}
