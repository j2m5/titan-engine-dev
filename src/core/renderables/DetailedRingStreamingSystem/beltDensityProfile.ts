interface BeltStructure {
  /** Ширина мягкой кромки, доля ширины пояса; 0 — резкие края */
  edgeSoftness: number
  /** Щели: центр и σ в долях ширины, depth — доля провала (1 — до нуля) */
  gaps: Array<{ at: number; width: number; depth: number }>
  /** Сгущения: центр и σ в долях ширины, gain — множитель в центре */
  clumps: Array<{ at: number; width: number; gain: number }>
  /**
   * Дуги — азимутальные сгущения: центр и σ в долях ОБОРОТА (0..1, угол
   * atan2(z, x) от оси +X через +Z), gain — множитель в центре. Отсутствие
   * или пустой список — плотность по углу ровная (см. buildBeltAngularProfile)
   */
  arcs?: Array<{ at: number; width: number; gain: number }>
}

/** smoothstep без GLSL: 0 при x ≤ 0, 1 при x ≥ 1 */
function smooth(x: number): number {
  const t: number = Math.min(Math.max(x, 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Радиальный профиль плотности пояса по долям ширины [0, 1]; бин i покрывает
 * [i/bins, (i+1)/bins), значение берётся в его центре. Массив идёт в
 * RadialDensityProfile тем же путём, что альфа текстуры у колец.
 */
export function buildBeltDensityProfile(structure: BeltStructure, bins: number = 1024): Float32Array {
  const out = new Float32Array(bins)
  const { edgeSoftness, gaps, clumps } = structure

  for (let i = 0; i < bins; i++) {
    const u: number = (i + 0.5) / bins
    let v: number = 1

    if (edgeSoftness > 0) v *= smooth(u / edgeSoftness) * smooth((1 - u) / edgeSoftness)
    for (const g of gaps) v *= 1 - g.depth * Math.exp(-0.5 * ((u - g.at) / g.width) ** 2)
    for (const c of clumps) v *= 1 + (c.gain - 1) * Math.exp(-0.5 * ((u - c.at) / c.width) ** 2)

    out[i] = Math.max(v, 0)
  }

  // Края: ровно ноль на крайних бинах при мягкой кромке
  if (edgeSoftness > 0) {
    out[0] = 0
    out[bins - 1] = 0
  }

  return out
}

/**
 * Азимутальный профиль плотности пояса по долям оборота [0, 1): бин i покрывает
 * [i/bins, (i+1)/bins) и отвечает углу 2π·i/bins по atan2(z, x). Профиль
 * периодичен (дуга у 0.98 продолжается в бины у нуля) — расстояние до центра
 * дуги берётся по кратчайшей стороне круга — и НОРМИРОВАН: среднее по обороту
 * ровно 1, дуги перераспределяют тела и пыль, не добавляя их. Пик дуги
 * поэтому равен gain, делённому на среднее ненормированного профиля.
 * null — дуг нет, потребители идут своим равномерным путём.
 */
export function buildBeltAngularProfile(structure: BeltStructure, bins: number = 1024): Float32Array | null {
  const arcs = structure.arcs ?? []
  if (arcs.length === 0) return null

  const out = new Float32Array(bins)
  let sum = 0

  for (let i = 0; i < bins; i++) {
    const u: number = (i + 0.5) / bins
    let v: number = 1

    for (const a of arcs) {
      // Кратчайшая дистанция по кругу: d ∈ [−0.5, 0.5)
      const d: number = u - a.at - Math.round(u - a.at)
      v *= 1 + (a.gain - 1) * Math.exp(-0.5 * (d / a.width) ** 2)
    }

    out[i] = Math.max(v, 0)
    sum += out[i]
  }

  const mean: number = sum / bins
  if (mean <= 0) return null
  for (let i = 0; i < bins; i++) out[i] /= mean

  return out
}

export type { BeltStructure }
