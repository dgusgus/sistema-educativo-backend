// src/lib/dimension.reglas.ts
//
// Reglas PURAS para editar una DimensionEvaluacion.
//
// ¿Para qué? puntajeMaximo y pesoEnPromedio entran en el promedio trimestral. Si se cambian
// cuando ya hay notas (o un trimestre cerrado), los promedios guardados dejan de coincidir con
// lo que se calcularía hoy y el boletín se desfasa del cuaderno. Cambiar solo el nombre, el
// orden o "autoevaluada" no afecta el cálculo y siempre se permite.

export function cambiaElCalculo(
  actual: { puntajeMaximo: unknown; pesoEnPromedio: unknown },
  cambios: { puntajeMaximo?: number; pesoEnPromedio?: number },
): boolean {
  const distinto = (a: unknown, b: number | undefined) => b !== undefined && Math.abs(Number(a) - b) > 1e-9
  return distinto(actual.puntajeMaximo, cambios.puntajeMaximo) || distinto(actual.pesoEnPromedio, cambios.pesoEnPromedio)
}

/** Mensaje de bloqueo (409) o null si se puede editar. `conNotasOCerrado` = actividades con notas o de trimestres cerrados. */
export function motivoBloqueoDimension(conNotasOCerrado: number): string | null {
  return conNotasOCerrado > 0
    ? `No se puede cambiar el puntaje máximo ni el peso: ${conNotasOCerrado} actividad(es) ya tienen notas o están en un trimestre cerrado y los promedios quedarían desfasados`
    : null
}