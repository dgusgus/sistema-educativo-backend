// prisma/seeds/vacio.ts
//
// PERFIL "vacio": lo mínimo para entrar y construir TODO desde la aplicación.
//   • institución, 4 campos de saber y 9 materias (el catálogo)
//   • la cuenta del DIRECTOR
// Sin gestión, cursos, docentes, secretaria ni estudiantes.
//
// Para qué: probar el arranque real — crear la gestión, los cursos y el personal,
// asignar materias, importar estudiantes desde Excel — y ver cómo se comporta la
// aplicación cuando todavía no hay nada (pantallas vacías, mensajes de "no hay gestión activa").
import { crearDirector, mostrarCredenciales, type Perfil } from './_comun.js'

export const vacio: Perfil = {
  descripcion: 'Solo catálogo + director. Todo lo demás se crea desde la aplicación.',
  async sembrar(ctx) {
    await crearDirector(ctx)

    console.log('\nVerificación:')
    const c = ctx.prisma
    ctx.verificar((await c.usuario.count()) === 1, 'una sola cuenta (director)')
    ctx.verificar((await c.materia.count()) >= 9 && (await c.campoSaber.count()) === 4, 'catálogo: materias y 4 campos de saber')
    ctx.verificar((await c.gestion.count()) === 0 && (await c.curso.count()) === 0, 'sin gestión ni cursos')

    mostrarCredenciales(['director / admin1234'])
    console.log('\nSIGUIENTE PASO (desde la app): Gestiones → crear la gestión · Estructura → cursos · Docentes → personal.')
  },
}
