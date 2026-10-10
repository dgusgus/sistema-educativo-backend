import { describe, it, expect } from 'vitest'
import { leerPaginacion, respuestaPaginada } from '../src/lib/paginacion.js'

describe('paginación opt-in', () => {
  it('sin ?pagina → null (el endpoint responde el arreglo completo, como antes)', () => {
    expect(leerPaginacion({})).toBeNull()
    expect(leerPaginacion({ limite: 10 })).toBeNull()
  })

  it('pagina 3 de 25 → salta 50', () => {
    expect(leerPaginacion({ pagina: 3 })).toEqual({ pagina: 3, limite: 25, skip: 50, take: 25 })
  })

  it('totalPaginas redondea hacia arriba y nunca es 0', () => {
    const p = leerPaginacion({ pagina: 1, limite: 10 })!
    expect(respuestaPaginada([], 25, p).meta.totalPaginas).toBe(3)
    expect(respuestaPaginada([], 0, p).meta.totalPaginas).toBe(1)
  })
})
