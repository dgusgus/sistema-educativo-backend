import { describe, it, expect } from 'vitest'
import { personaDe, ciDe, espacioDePrefijo, DIRECTOR_DEMO, SECRETARIA_DEMO, type Espacio } from '../prisma/seeds/datos-bolivia.js'

// Cantidades máximas que usan los perfiles (con holgura)
const USO: Array<[Espacio, number]> = [['EST', 1900], ['EGR', 1900], ['EGR2', 1900], ['RET', 1900], ['PROMO', 1900], ['TUT', 2400], ['DOC', 1200]]

describe('datos-bolivia: personas realistas para las semillas', () => {
  const todas = USO.flatMap(([e, n]) => Array.from({ length: n }, (_, k) => personaDe(e, k + 1)))

  it('nunca repite nombre + apellido', () => {
    const claves = new Set(todas.map(p => `${p.nombre} ${p.apellido}`))
    expect(claves.size).toBe(todas.length)
  })

  it('el CI es único en toda la base (incluidos director y secretaria)', () => {
    const cis = [...todas.map(p => p.ci), DIRECTOR_DEMO.ci, SECRETARIA_DEMO.ci]
    expect(new Set(cis).size).toBe(cis.length)
  })

  it('el CI son 7 dígitos y, a veces, un complemento dígito+letra', () => {
    for (const p of todas) expect(p.ci).toMatch(/^\d{7}(-[1-9][A-Z])?$/)
    const conComplemento = todas.filter(p => p.ci.includes('-')).length / todas.length
    expect(conComplemento).toBeGreaterThan(0.04)
    expect(conComplemento).toBeLessThan(0.11)
  })

  it('cumple la validación de CI del sistema (3-20 caracteres, sin símbolos raros)', () => {
    for (const p of todas) expect(p.ci).toMatch(/^[0-9A-Za-z][0-9A-Za-z\-. ]*$/)
  })

  it('apellido paterno y materno distintos; sexo y teléfono válidos', () => {
    for (const p of todas.slice(0, 3000)) {
      const [a, b] = p.apellido.split(' ')
      expect(a).not.toBe(b)
      expect(p.telefono).toMatch(/^[67]\d{7}$/)
      expect(['MASCULINO', 'FEMENINO']).toContain(p.sexo)
    }
  })

  it('hay de ambos sexos en proporción razonable', () => {
    const mujeres = todas.filter(p => p.sexo === 'FEMENINO').length / todas.length
    expect(mujeres).toBeGreaterThan(0.4)
    expect(mujeres).toBeLessThan(0.6)
  })

  it('es determinista', () => {
    expect(personaDe('EST', 450)).toEqual(personaDe('EST', 450))
    expect(ciDe(42)).toBe(ciDe(42))
  })

  it('traduce los prefijos históricos y rechaza los desconocidos', () => {
    expect(espacioDePrefijo('V')).toBe('EST')
    expect(() => espacioDePrefijo('Z')).toThrow()
  })
})