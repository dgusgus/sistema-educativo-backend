// src/lib/cuaderno.horario.ts
//
// Arma la grilla del horario del curso (periodos × días) a partir de las filas de la tabla Horario.
// Función pura: sin base de datos ni Excel.
//
// ¿Para qué? El Excel traía 7 periodos y 2 recreos escritos a mano. Aquí los periodos salen de los
// horarios REALES cargados en el sistema (cualquier cantidad de periodos), y el recreo se detecta solo:
// si entre un periodo y el siguiente hay un hueco de tiempo, ahí va la fila "R E C R E O".

export const DIAS_SEMANA = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'] as const
export type DiaHorario = (typeof DIAS_SEMANA)[number]

export interface ItemHorario {
  dia: DiaHorario
  /** "HH:MM" */
  inicio: string
  fin: string
  materia: string
  aula: string | null
}

export interface FranjaHorario {
  inicio: string
  fin: string
  /** true si entre la franja anterior y esta hay un hueco (recreo) */
  recreoAntes: boolean
  /** texto por día; varias materias en la misma franja y día se unen con " / " */
  celdas: Partial<Record<DiaHorario, string>>
}

export interface HorarioCurso {
  dias: DiaHorario[]
  franjas: FranjaHorario[]
}

/** Date de una columna TIME de Postgres (llega como 1970-01-01T08:00Z) → "08:00" */
export function horaTexto(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(fecha.getUTCHours())}:${p(fecha.getUTCMinutes())}`
}

const aMinutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export function armarHorario(items: ItemHorario[]): HorarioCurso {
  // Lunes a viernes siempre; el sábado solo si hay clases ese día
  const dias: DiaHorario[] = DIAS_SEMANA.filter(d => d !== 'SABADO' || items.some(i => i.dia === 'SABADO'))

  const claves = new Map<string, { inicio: string; fin: string }>()
  for (const i of items) claves.set(`${i.inicio}-${i.fin}`, { inicio: i.inicio, fin: i.fin })
  const ordenadas = [...claves.values()].sort((a, b) => aMinutos(a.inicio) - aMinutos(b.inicio) || aMinutos(a.fin) - aMinutos(b.fin))

  const franjas: FranjaHorario[] = ordenadas.map((f, idx) => {
    const celdas: FranjaHorario['celdas'] = {}
    for (const i of items.filter(x => x.inicio === f.inicio && x.fin === f.fin)) {
      const texto = i.aula ? `${i.materia} (${i.aula})` : i.materia
      celdas[i.dia] = celdas[i.dia] ? `${celdas[i.dia]} / ${texto}` : texto
    }
    const anterior = ordenadas[idx - 1]
    return { ...f, recreoAntes: !!anterior && aMinutos(f.inicio) - aMinutos(anterior.fin) >= 10, celdas }
  })

  return { dias, franjas }
}
