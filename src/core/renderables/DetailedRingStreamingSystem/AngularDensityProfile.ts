const TWO_PI = Math.PI * 2

/**
 * AngularDensityProfile — азимутальный профиль плотности пояса (дуги, см.
 * buildBeltAngularProfile): кусочно-постоянный вес по углу, бин i покрывает
 * [2π·i/bins, 2π·(i+1)/bins) по atan2(z, x). Периодичен — интервалы и
 * префикс-масса продолжаются через 0/2π без шва.
 *
 * Радиальный аналог — RadialDensityProfile; здесь без множителя r: площадь
 * сектора уже учтена потребителем, вес — среднее профиля по углу.
 *
 * Потребители:
 * - SectorGrid.weightForRange — средний вес углового интервала сектора →
 *   КОЛИЧЕСТВО камней сектора;
 * - BeltPointLayer.sampleAngle — inverse-CDF розыгрыш угла точки.
 */
class AngularDensityProfile {
  private readonly weights: Float32Array
  /** Угловая ширина одного бина, радианы */
  private readonly step: number
  /** cumulative[i] = ∫ w dθ от 0 до начала бина i (длина bins + 1); Float64 — сумма тысячи слагаемых */
  private readonly cumulative: Float64Array
  /** Полная масса оборота, ∫₀^{2π} w dθ */
  private readonly total: number

  public constructor(weights: ArrayLike<number>) {
    if (weights.length < 1) throw new Error('AngularDensityProfile: нужен непустой профиль')

    this.weights = Float32Array.from(weights)
    this.step = TWO_PI / this.weights.length

    this.cumulative = new Float64Array(this.weights.length + 1)
    for (let i = 0; i < this.weights.length; i++) {
      this.cumulative[i + 1] = this.cumulative[i] + this.weights[i] * this.step
    }
    this.total = this.cumulative[this.weights.length]
  }

  /**
   * Средний вес интервала углов [a0, a1] (радианы, любой отсчёт: интервал
   * через 0/2π и отрицательные углы допустимы, a1 < a0 читается как дуга
   * вперёд от a0 по кругу). Интервал длиннее оборота даёт среднее по
   * обороту; вырожденный — вес в точке a0.
   */
  public weightForRange(a0: number, a1: number): number {
    let span = a1 - a0
    if (span >= TWO_PI) return this.total / TWO_PI
    if (span < 0) span = ((span % TWO_PI) + TWO_PI) % TWO_PI
    if (span <= 0) return this.weights[this.binOf(a0)]

    return (this.massUpTo(a0 + span) - this.massUpTo(a0)) / span
  }

  /**
   * Угол по инверсии CDF с pdf ∝ w(θ): тела концентрируются в дугах. Тратит
   * ровно одно случайное число u ∈ [0, 1); результат в [0, 2π). Профиль без
   * массы → равномерно, как без профиля.
   */
  public sampleAngle(u: number): number {
    if (this.total <= 0) return u * TWO_PI

    const target = u * this.total

    // Наибольший бин с cumulative[i] <= target (бинарный поиск по префикс-массе)
    let lo = 0
    let hi = this.weights.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.cumulative[mid] <= target) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }

    const w = this.weights[lo]
    const binStart = lo * this.step
    const theta = w > 0 ? binStart + (target - this.cumulative[lo]) / w : binStart

    // Краевой float у u → 1 упирается в 2π — тот же угол, что 0
    return theta >= TWO_PI ? 0 : Math.max(theta, 0)
  }

  /** ∫ w dθ от 0 до θ для любого вещественного θ — целые обороты по полной массе */
  private massUpTo(theta: number): number {
    const turns = Math.floor(theta / TWO_PI)
    const local = theta - turns * TWO_PI
    const bin = Math.min(Math.floor(local / this.step), this.weights.length - 1)

    return turns * this.total + this.cumulative[bin] + this.weights[bin] * (local - bin * this.step)
  }

  private binOf(theta: number): number {
    const local = theta - Math.floor(theta / TWO_PI) * TWO_PI
    return Math.min(Math.floor(local / this.step), this.weights.length - 1)
  }
}

export { AngularDensityProfile }
