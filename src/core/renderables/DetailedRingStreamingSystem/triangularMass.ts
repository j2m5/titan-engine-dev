/**
 * Доля массы треугольного распределения (пик в нуле, нули на ±half) в полосе
 * [y0, y1]. Тем же законом генератор раскладывает камни по толщине кольца
 * (см. triangularHeight) — здесь он применён к целой ячейке.
 */
export function triangularMass(y0: number, y1: number, half: number): number {
  if (half <= 0) return 0

  return triangularCdf(y1, half) - triangularCdf(y0, half)
}

/** Функция распределения: 0 на −half, 0.5 в нуле, 1 на +half */
function triangularCdf(y: number, half: number): number {
  const t = Math.max(-half, Math.min(half, y)) / half

  return t >= 0 ? 0.5 + t - (t * t) * 0.5 : 0.5 + t + (t * t) * 0.5
}
