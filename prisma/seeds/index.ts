// prisma/seeds/index.ts
//
// Lanzador de perfiles de semilla.
//
//   pnpm db:seed:perfil <perfil> [--limpiar]
//
//   vacio       solo catálogo + director                      (arranque desde cero)
//   estructura  colegio armado, sin estudiantes               (inscribir, importar, cargar notas)
//   promocion   fin de año con un caso de cada rama           (Paso 1 y Paso 2 de Promoción)
//   volumen     ~900 estudiantes                              (paginación, búsqueda, rendimiento)
//   defensa     el seed de siempre (T3 al ~85 %)              → prisma/seed.ts
//   cierre      T3 al 100 %, listo para cerrar la gestión     → prisma/seed.ts con SEED_T3_COMPLETO=si
//
//   --limpiar   vacía TODAS las tablas de datos antes de sembrar (solo bases locales; las
//               migraciones se conservan). Sin esto, el lanzador se niega a sembrar sobre
//               una base que ya tiene datos. Así cambiar de perfil es UN comando.
//
// Variables opcionales: SEED_ANCLA=AAAA-MM-DD (fija "hoy"), SEED_FORZAR=si (permite --limpiar en un host no local).
import { spawnSync } from 'node:child_process'
import { iniciar, type Perfil } from './_comun.js'
import { vacio } from './vacio.js'
import { estructura } from './estructura.js'
import { promocion } from './promocion.js'
import { volumen } from './volumen.js'

const PERFILES: Record<string, Perfil> = { vacio, estructura, promocion, volumen }
const DELEGADOS: Record<string, { descripcion: string; env: Record<string, string> }> = {
  defensa: { descripcion: 'El seed de siempre (prisma/seed.ts), T3 al ~85 %.', env: {} },
  cierre:  { descripcion: 'prisma/seed.ts con T3 al 100 %: listo para cerrar la gestión.', env: { SEED_T3_COMPLETO: 'si' } },
}

const [nombre, ...flags] = process.argv.slice(2)
const limpiar = flags.includes('--limpiar') || process.env.SEED_LIMPIAR === 'si'

function ayuda(): never {
  console.log('Uso: pnpm db:seed:perfil <perfil> [--limpiar]\n')
  for (const [n, p] of Object.entries(PERFILES)) console.log(`  ${n.padEnd(11)} ${p.descripcion}`)
  for (const [n, p] of Object.entries(DELEGADOS)) console.log(`  ${n.padEnd(11)} ${p.descripcion}`)
  process.exit(nombre ? 1 : 0)
}

async function main() {
  if (!nombre || (!(nombre in PERFILES) && !(nombre in DELEGADOS))) ayuda()

  // defensa / cierre: los siembra seed.ts (que trae sus propias guardas); aquí solo se limpia antes si se pidió.
  if (nombre in DELEGADOS) {
    if (limpiar) {
      const ctx = await iniciar(true)
      await ctx.cerrar()   // vacía y vuelve a sembrar el catálogo; seed.ts lo usa con upsert, no se pisa
    }
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], {
      stdio: 'inherit', env: { ...process.env, ...DELEGADOS[nombre].env },
    })
    process.exit(r.status ?? 1)
  }

  const t0 = Date.now()
  console.log(`🌱 Perfil "${nombre}": ${PERFILES[nombre].descripcion}\n`)
  const ctx = await iniciar(limpiar)
  try {
    await PERFILES[nombre].sembrar(ctx)
  } finally {
    await ctx.cerrar()
  }
  if (ctx.fallos.length) {
    console.error(`\n❌ ${ctx.fallos.length} verificación(es) fallaron.`)
    process.exitCode = 1
  } else {
    console.log(`\n✅ Listo en ${((Date.now() - t0) / 1000).toFixed(1)} s.`)
  }
}

main().catch(e => {
  console.error('❌ Seed falló:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
