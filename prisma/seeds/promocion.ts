// prisma/seeds/promocion.ts
//
// PERFIL "promocion": fin de año listo para PROMOCIONAR, con un caso de cada rama.
//   • Gestión del año ACTIVA con los 3 trimestres CERRADOS y todas las notas cargadas
//   • Gestión siguiente INACTIVA con su estructura copiada (cursos 1°-6° en A y B)
//   • 6 cursos (1°-6° "A") × 8 estudiantes = 48 inscripciones
//
// CASOS (por curso de origen):
//   k=0  REPROBADO  → Matemáticas ~40, el resto aprobado (repite el grado)
//   k=1  PROMOVIDO  → promedios altos
//   k=2  SIN RESULTADO en 1°A y 3°A → falta la nota del T3 en una materia (INCOMPLETO en el Paso 1)
//   k=3  RETIRADO en 1°A · TRANSFERIDO en 2°A → aparecen en "Retirados o transferidos"
//   k=4  en 3°A el resultado YA está registrado (PROMOVIDO): prueba "solo los que faltan registrar"
//   k=5  en 2°A YA MATRICULADO en 3°A de la gestión siguiente: prueba "ya matriculados"
//   6°A  los aprobados EGRESAN (no se matriculan) y el reprobado repite 6°
// Para qué: recorrer el Paso 1 (resultados) y el Paso 2 (matrícula) viendo todas las ramas.
import {
  crearDirector, crearSecretaria, crearDocentes, crearGestion, crearDimensiones, crearConceptosPago,
  crearCursos, asignarMaterias, crearEstudiantes, ponerNotas, mesRel, mostrarCredenciales,
  type Perfil, type PerfilNotas, type InscripcionNotas,
} from './_comun.js'

const POR_CURSO = 8
const GRADOS = [1, 2, 3, 4, 5, 6]

function perfilDe(grado: number, k: number): PerfilNotas {
  if (k === 0) return 'REPRUEBA_MAT'
  if (k === 1) return 'ALTO'
  if (k === 2 && (grado === 1 || grado === 3)) return 'INCOMPLETO'
  if (k === 3 && (grado === 1 || grado === 2)) return 'RETIRADO'
  return k % 2 === 0 ? 'MEDIO' : 'ALTO'
}

export const promocion: Perfil = {
  descripcion: 'Fin de año: T1-T3 cerrados, notas completas, gestión siguiente con estructura. Un caso de cada rama de Promoción.',
  async sembrar(ctx) {
    const c = ctx.prisma
    const director = await crearDirector(ctx)
    await crearSecretaria(ctx)
    const docentes = await crearDocentes(ctx, 8)

    // ── Gestión del año (activa, todo cerrado) y la siguiente (inactiva, abierta) ──
    const origen = await crearGestion(ctx, {
      anio: ctx.ANIO, activa: true, descripcion: `Gestión Escolar ${ctx.ANIO} (lista para promoción)`, directorId: director.id,
      meses: [mesRel(ctx.ANCLA, -2), mesRel(ctx.ANCLA, -1), mesRel(ctx.ANCLA, 0)], cerrados: [true, true, true],
    })
    const destino = await crearGestion(ctx, {
      anio: ctx.ANIO + 1, activa: false, descripcion: `Gestión Escolar ${ctx.ANIO + 1} (estructura copiada)`, directorId: director.id,
      meses: [mesRel(ctx.ANCLA, 1), mesRel(ctx.ANCLA, 2), mesRel(ctx.ANCLA, 3)], cerrados: [false, false, false],
    })
    for (const g of [origen.gestion, destino.gestion]) { await crearDimensiones(ctx, g.id); await crearConceptosPago(ctx, g.id) }

    const cursosO = await crearCursos(ctx, origen.gestion.id, GRADOS, ['A'])
    const cursosD = await crearCursos(ctx, destino.gestion.id, GRADOS, ['A', 'B'])   // dos opciones por grado: prueba la sugerencia
    const asigO = await asignarMaterias(ctx, origen.gestion.id, cursosO, docentes)
    await asignarMaterias(ctx, destino.gestion.id, cursosD, docentes)

    // ── Estudiantes e inscripciones ──
    const estudiantes = await crearEstudiantes(ctx, GRADOS.length * POR_CURSO, { prefijoCi: 'PR' })
    const filas: (InscripcionNotas & { grado: number; k: number })[] = []
    let n = 0
    for (const curso of cursosO) {
      for (let k = 0; k < POR_CURSO; k++, n++) {
        const e = estudiantes[n]
        const perfil = perfilDe(curso.grado, k)
        const estado = k === 3 && curso.grado === 1 ? 'RETIRADA' : k === 3 && curso.grado === 2 ? 'TRANSFERIDA' : 'ACTIVA'
        const insc = await c.inscripcion.create({
          data: {
            estudianteId: e.estudianteId, cursoId: curso.id, gestionId: origen.gestion.id, estadoInscripcion: estado,
            ...(estado !== 'ACTIVA' ? { fechaRetiro: new Date(Date.UTC(ctx.ANIO, 0, 15)) } : {}),
          },
        })
        filas.push({ inscripcionId: insc.id, idx: n, perfil, asignaciones: asigO.get(curso.id)!, grado: curso.grado, k })
      }
    }
    const aprueba = await ponerNotas(ctx, origen.trimestres, filas)

    // 3°A, k=4: resultado ya registrado (el que el sistema calcularía)
    const f34 = filas.find(f => f.grado === 3 && f.k === 4)!
    await c.inscripcion.update({ where: { id: f34.inscripcionId }, data: { resultado: aprueba.get(f34.inscripcionId) ? 'PROMOVIDO' : 'REPROBADO' } })

    // 2°A, k=5: ya promovido Y matriculado en 3°A de la gestión siguiente
    const f25 = filas.find(f => f.grado === 2 && f.k === 5)!
    await c.inscripcion.update({ where: { id: f25.inscripcionId }, data: { resultado: 'PROMOVIDO' } })
    const est25 = await c.inscripcion.findUniqueOrThrow({ where: { id: f25.inscripcionId }, select: { estudianteId: true } })
    const tercero = cursosD.find(x => x.grado === 3 && x.paralelo === 'A')!
    await c.inscripcion.create({ data: { estudianteId: est25.estudianteId, cursoId: tercero.id, gestionId: destino.gestion.id } })

    // ── Verificación ──
    console.log('\nVerificación:')
    ctx.verificar((await c.gestion.count({ where: { activa: true } })) === 1, 'exactamente una gestión activa')
    ctx.verificar((await c.trimestre.count({ where: { gestionId: origen.gestion.id, cerrado: true } })) === 3, 'origen: 3 trimestres cerrados')
    ctx.verificar((await c.inscripcion.count({ where: { gestionId: origen.gestion.id } })) === GRADOS.length * POR_CURSO, `${GRADOS.length * POR_CURSO} inscripciones en el origen`)
    ctx.verificar((await c.inscripcion.count({ where: { gestionId: origen.gestion.id, estadoInscripcion: { in: ['RETIRADA', 'TRANSFERIDA'] } } })) === 2, '1 retirado y 1 transferido')
    ctx.verificar([...aprueba.values()].filter(v => v === null).length === 4, '4 sin resultado posible (2 incompletos + 2 retirados/transferidos)')
    ctx.verificar((await c.inscripcion.count({ where: { gestionId: destino.gestion.id } })) === 1, 'destino: 1 ya matriculado (2°A → 3°A)')
    ctx.verificar((await c.curso.count({ where: { gestionId: destino.gestion.id } })) === GRADOS.length * 2, 'destino: cursos 1°-6° en A y B')

    mostrarCredenciales(['director / admin1234 · secretaria / sec1234 · doc01..doc08 / doc1234'])
    console.log('\nRECORRIDO: Promoción de Gestión → abrir cada curso → Paso 1 (registrar) → Paso 2 (matricular en la gestión siguiente).')
    console.log('  1°A: reprobado, sin resultado, retirado · 2°A: transferido, ya matriculado · 3°A: sin resultado, resultado ya registrado · 6°A: egresan + 1 repite')
  },
}
