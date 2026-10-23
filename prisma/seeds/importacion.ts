// prisma/seeds/importacion.ts
//
// PERFIL "importacion": el colegio de 900 estudiantes ARMADO pero VACÍO de personas, para probar
// las importaciones desde Excel con los archivos de `generar-excel.ts`.
//   • director + secretaria (sin docentes ni estudiantes)
//   • gestión del año ACTIVA, 3 trimestres abiertos, 4 dimensiones, 3 conceptos de pago
//   • 24 cursos (1°-6° × A, B, C, D), códigos 1AS … 6DS
//
// Después: pnpm tsx prisma/seeds/generar-excel.ts  →  importar en orden 1_docentes, 2_estudiantes, 3_tutores
// (la importación de estudiantes inscribe a cada uno en su curso; la de tutores los vincula por CI).
// Las asignaciones docente-materia-curso y los horarios se arman desde la app (o con el perfil "carga").
import {
  crearDirector, crearSecretaria, crearGestion, crearDimensiones, crearConceptosPago, crearCursos,
  mesRel, mostrarCredenciales, type Perfil,
} from './_comun.js'

export const importacion: Perfil = {
  descripcion: 'Colegio con 24 cursos (A-D) sin docentes ni estudiantes: para importar los Excel de generar-excel.ts.',
  async sembrar(ctx) {
    const director = await crearDirector(ctx)
    await crearSecretaria(ctx)
    const { gestion } = await crearGestion(ctx, {
      anio: ctx.ANIO, activa: true, descripcion: `Gestión Escolar ${ctx.ANIO}`, directorId: director.id,
      meses: [mesRel(ctx.ANCLA, -1), mesRel(ctx.ANCLA, 0), mesRel(ctx.ANCLA, 1)], cerrados: [false, false, false],
    })
    await crearDimensiones(ctx, gestion.id)
    await crearConceptosPago(ctx, gestion.id)
    await crearCursos(ctx, gestion.id, [1, 2, 3, 4, 5, 6], ['A', 'B', 'C', 'D'])

    console.log('\nVerificación:')
    const c = ctx.prisma
    ctx.verificar((await c.curso.count()) === 24, '24 cursos (6 grados × A, B, C, D)')
    ctx.verificar((await c.estudiante.count()) === 0 && (await c.docente.count()) === 0, 'sin estudiantes ni docentes')
    mostrarCredenciales(['director / admin1234', 'secretaria / sec1234'])
    console.log('\nSIGUIENTE PASO: Docentes → Importar (1_docentes.xlsx) · Estudiantes → Importar con la gestión activa (2_estudiantes.xlsx) · Tutores → Importar (3_tutores.xlsx) · 4_estudiantes_con_errores.xlsx para ver el reporte de errores.')
  },
}