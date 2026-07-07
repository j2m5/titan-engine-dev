/**
 * RadialDensityProfile — радиальный профиль плотности камней из альфы текстуры кольца.
 *
 * Хранит кусочно-постоянную альфу по радиусу: бин i покрывает
 * [inner + i·step, inner + (i+1)·step), плюс префикс-интеграл
 * C(r) = ∫ α(t)·t dt — «массу» камней на единицу угла до радиуса r
 * (множитель t — потому что площадь дуги растёт с радиусом).
 *
 * Потребители (см. AsteroidRingSystem.__tryBuildDensityProfile):
 * - SectorGrid.weightForBand — средняя альфа полосы, взвешенная по площади →
 *   верное КОЛИЧЕСТВО камней сектора (пустоты дают 0 → сектор не генерится);
 * - AsteroidGenerator.sampleRadius — inverse-CDF семплинг радиуса с pdf ∝ α(r)·r →
 *   КОНЦЕНТРАЦИЯ камней в колечках.
 * Вместе поверхностная плотность камней = densityPerUnit · α(r).
 */
class RadialDensityProfile {
  /** Кусочно-постоянная альфа по радиальным бинам */
  private readonly alpha: Float32Array
  private readonly innerRadius: number
  private readonly outerRadius: number
  /** Радиальная ширина одного бина */
  private readonly step: number
  /**
   * cumulative[i] = ∫ α(r)·r dr от innerRadius до начала бина i (длина bins + 1).
   * Float64 — суммируем до тысячи слагаемых порядка r², точности float32 мало.
   */
  private readonly cumulative: Float64Array

  public constructor(alpha: ArrayLike<number>, innerRadius: number, outerRadius: number) {
    if (alpha.length < 1 || !(outerRadius > innerRadius)) {
      throw new Error('RadialDensityProfile: нужен непустой профиль и outerRadius > innerRadius')
    }

    this.alpha = Float32Array.from(alpha)
    this.innerRadius = innerRadius
    this.outerRadius = outerRadius
    this.step = (outerRadius - innerRadius) / this.alpha.length

    this.cumulative = new Float64Array(this.alpha.length + 1)
    for (let i = 0; i < this.alpha.length; i++) {
      const r0 = innerRadius + i * this.step
      const r1 = r0 + this.step
      this.cumulative[i + 1] = this.cumulative[i] + this.alpha[i] * 0.5 * (r1 * r1 - r0 * r0)
    }
  }

  /**
   * Средняя альфа полосы [minRadius, maxRadius], взвешенная по площади:
   * ∫ α(r)·r dr / ∫ r dr. 1 — полностью непрозрачная полоса, 0 — пустота.
   * Границы за пределами профиля клампятся.
   */
  public weightForBand(minRadius: number, maxRadius: number): number {
    const lo = this.clampRadius(minRadius)
    const hi = this.clampRadius(maxRadius)
    const areaTerm = 0.5 * (hi * hi - lo * lo)
    if (areaTerm <= 0) return 0

    return (this.massUpTo(hi) - this.massUpTo(lo)) / areaTerm
  }

  /**
   * Радиус по инверсии CDF с pdf ∝ α(r)·r внутри [minRadius, maxRadius] —
   * камни концентрируются в колечках с высокой альфой. Тратит ровно одно
   * случайное число u ∈ [0, 1) (детерминизм генератора не сдвигается).
   * Полоса без массы (сюда не должны попадать — weightForBand даёт 0) →
   * fallback: равномерно по площади, как без профиля.
   */
  public sampleRadius(minRadius: number, maxRadius: number, u: number): number {
    const massLo = this.massUpTo(minRadius)
    const total = this.massUpTo(maxRadius) - massLo

    if (total <= 0) {
      const r1Sq = minRadius * minRadius
      const r2Sq = maxRadius * maxRadius
      return Math.sqrt(r1Sq + u * (r2Sq - r1Sq))
    }

    const target = massLo + u * total

    // Наибольший бин с cumulative[i] <= target: плато нулевых бинов пропускается,
    // поиск попадает в бин с α > 0, содержащий target (бинарный поиск по префикс-массе).
    let lo = 0
    let hi = this.alpha.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.cumulative[mid] <= target) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }

    // Инверсия внутри бина: α·½(r² − r0²) = target − C(r0) → r.
    // α = 0 возможен лишь на краевом float (target == массе хвостового плато) —
    // тогда локальная масса 0 и берём начало бина.
    const binAlpha = this.alpha[lo]
    const binStart = this.innerRadius + lo * this.step
    const localMass = target - this.cumulative[lo]
    const r = binAlpha > 0 ? Math.sqrt(binStart * binStart + (2 * localMass) / binAlpha) : binStart

    // Страховка от краевых погрешностей float на границах полосы
    return Math.min(Math.max(r, minRadius), maxRadius)
  }

  /** ∫ α(r)·r dr от innerRadius до r (с клампом в диапазон профиля) */
  private massUpTo(r: number): number {
    const clamped = this.clampRadius(r)
    const bin = Math.min(Math.floor((clamped - this.innerRadius) / this.step), this.alpha.length - 1)
    const binStart = this.innerRadius + bin * this.step

    return this.cumulative[bin] + this.alpha[bin] * 0.5 * (clamped * clamped - binStart * binStart)
  }

  private clampRadius(r: number): number {
    return Math.min(Math.max(r, this.innerRadius), this.outerRadius)
  }
}

export { RadialDensityProfile }
