// src/lib/monto-letras.ts
// Monto en letras para recibos: 1250.50 → "MIL DOSCIENTOS CINCUENTA 50/100 BOLIVIANOS"

const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

function menorDeMil(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  const c = Math.floor(n / 100), r = n % 100
  const partes: string[] = []
  if (c) partes.push(CENTENAS[c])
  if (r) {
    if (r < 30) partes.push(UNIDADES[r])
    else {
      const d = Math.floor(r / 10), u = r % 10
      partes.push(u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d])
    }
  }
  return partes.join(' ')
}

export function enteroALetras(n: number): string {
  if (n === 0) return 'CERO'
  const millones = Math.floor(n / 1_000_000)
  const miles = Math.floor((n % 1_000_000) / 1000)
  const resto = n % 1000
  const partes: string[] = []
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${menorDeMil(millones)} MILLONES`)
  if (miles) partes.push(miles === 1 ? 'MIL' : `${menorDeMil(miles).replace(/UN$/, 'UN')} MIL`)
  if (resto) partes.push(menorDeMil(resto))
  return partes.join(' ')
}

export function montoEnLetras(monto: number): string {
  const centavos = Math.round(monto * 100)
  const entero = Math.floor(centavos / 100)
  const cent = String(centavos % 100).padStart(2, '0')
  return `${enteroALetras(entero)} ${cent}/100 BOLIVIANOS`
}