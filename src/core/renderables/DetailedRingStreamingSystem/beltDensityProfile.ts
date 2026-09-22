interface BeltStructure {
  /** Ширина мягкой кромки, доля ширины пояса; 0 — резкие края */
  edgeSoftness: number
  /** Щели: центр и σ в долях ширины, depth — доля провала (1 — до нуля) */
  gaps: Array<{ at: number; width: number; depth: number }>
  /** Сгущения: центр и σ в долях ширины, gain — множитель в центре */
  clumps: Array<{ at: number; width: number; gain: number }>
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

export type { BeltStructure }
