import { Vector3 } from 'three'
import { snoiseGrad3, type NoiseGrad3 } from './simplexNoise3'
import type { MidbandParams } from './midbandParams'

export const MIDBAND_ASPECT = 0.03
export const MIDBAND_OCTAVES = 3
export const MIDBAND_LACUNARITY = 2
export const MIDBAND_GAIN = 0.5
export const MIDBAND_ENVELOPE_MAX = 2
/** Домен варпа — вдвое грубее базовой октавы. */
const WARP_FREQUENCY = 0.5
/** Смещение домена варпа от домена октав — иначе варп коррелирует с гребнями. */
const WARP_OFFSET = 31.7

/**
 * Среднее гребневой октавы r = 1 − |snoise| по домену: E[r] = 1 − E|snoise|.
 * E|snoise| ≈ 0.309 по обходу 200k точек домена (страж в midbandField.spec
 * пересчитывает и падает при расхождении > 0.02) ⇒ E[r] ≈ 0.691, округлено
 * до 0.69. Вычитается из r в `sample` — центрирует смещение (среднее ≈ 0):
 * без центрирования (вычитание 0.5 вместо среднего) тело «толстело» —
 * аплифт +2.4 м на равнине и +31 м на стенах (замер живой карты Луны,
 * ревью всей ветки).
 */
export const MIDBAND_RIDGE_MEAN = 0.69

/**
 * Бонд |r − MIDBAND_RIDGE_MEAN|: аналитический максимум 0.69 при |n| → 1
 * (r → 0, |0 − 0.69| = 0.69), запас округлён вверх до 0.7. Это НЕ p99 —
 * имя историческое (переименовывать не нужно, на него пинуются консьюмеры
 * и другие константы), но с центрированием бонд стал точным максимумом,
 * а не статистической оценкой.
 */
export const MIDBAND_P99 = 0.7
/**
 * max |∇r| единичной гребневой октавы в единицах 1/домен = max |∇snoise|
 * (модуль меняет только знак). Аналитический градиент snoiseGrad3 по 100k
 * точкам обхода домена даёт maxGrad ≈ 6.139, ×1.1 ≈ 6.753, округлено вверх до
 * 7 (страж в midbandField.spec пересчитывает и падает, если эмпирика выше).
 * Число архива этапа 5 (27.6) было артефактом конечных разностей h=1e-4 на
 * стыках симплексов — с ним липшицев шаг марча коллизии стал бы мельче.
 */
export const MIDBAND_GRAD_BOUND = 7

export interface MidbandEnvelope {
  /** Уклон карты на текселе, tan. */
  slopeTan: number
  /** Нормированная кривизна карты: + выпуклость (кромка/гребень), − вогнутость; [-1, 1]. */
  curvature: number
  /** Единичное направление «вниз по склону» в базисе восток/север. */
  downE: number
  downN: number
}

export interface MidbandSample {
  heightMeters: number
  /** Наклон полосы, tan: производная высоты по дуге вдоль востока / севера точки. */
  tiltE: number
  tiltN: number
}

const UP = new Vector3(0, 1, 0)

/**
 * Геометрия средней полосы (арка B): гребневой шум 3 октавы с варпом домена
 * вдоль стока, амплитуда A_i = ASPECT·λ_i, огибающая от уклона/кривизны карты.
 * Домен dir·R/λ₀ бесшовен на сфере. Все наклоны — аналитический градиент
 * (без попиксельного шума в шейдере: наклон уходит атрибутом midTilt).
 * Бонды (maxAmplitudeMeters, slopeBound) консервативны: огибающая ≤ ENVELOPE_MAX.
 */
export class MidbandField {
  public readonly wavelengthsMeters: ReadonlyArray<number>
  public readonly amplitudesMeters: ReadonlyArray<number>
  public readonly maxAmplitudeMeters: number
  public readonly slopeBound: number
  private readonly domainScale: number
  private readonly strength: number
  private readonly east = new Vector3()
  private readonly north = new Vector3()
  private readonly grad: NoiseGrad3 = { value: 0, dx: 0, dy: 0, dz: 0 }
  private readonly warpGrad: NoiseGrad3 = { value: 0, dx: 0, dy: 0, dz: 0 }

  public constructor(
    private readonly params: MidbandParams,
    private readonly baseWavelengthMeters: number,
    radiusMeters: number
  ) {
    const wavelengths: number[] = []
    const amplitudes: number[] = []
    for (let i = 0; i < MIDBAND_OCTAVES; i++) {
      const lambda = baseWavelengthMeters / MIDBAND_LACUNARITY ** i
      wavelengths.push(lambda)
      amplitudes.push(MIDBAND_ASPECT * lambda) // = A₀·GAIN^i при GAIN = 1/LACUNARITY
    }
    this.wavelengthsMeters = wavelengths
    this.amplitudesMeters = amplitudes
    this.strength = params.midbandStrength
    this.domainScale = radiusMeters / baseWavelengthMeters
    const scale = this.strength * MIDBAND_ENVELOPE_MAX
    this.maxAmplitudeMeters = scale * amplitudes.reduce((s, a) => s + a * MIDBAND_P99, 0)
    // наклон октавы i: A_i·|∇r|·2^i/λ₀ = A_i·GRAD_BOUND/λ_i; варп добавляет множитель (1 + warp·GRAD_BOUND·WARP_FREQUENCY) к производной домена
    const warpFactor = 1 + params.midbandWarp * MIDBAND_GRAD_BOUND * WARP_FREQUENCY
    this.slopeBound = scale * warpFactor * amplitudes.reduce((s, a, i) => s + (a * MIDBAND_GRAD_BOUND) / wavelengths[i], 0)
  }

  public envelope(e: MidbandEnvelope): number {
    const slope = Math.min(1, Math.max(0, e.slopeTan / this.params.midbandSlopeRef))
    const ridge = this.params.midbandRidge * Math.max(0, e.curvature)

    return Math.min(MIDBAND_ENVELOPE_MAX, Math.max(0, this.params.midbandFlat + slope + ridge))
  }

  /** strength·ENVELOPE_MAX·Σ A_i·P99 по октавам короче порога (тот же множитель, что у maxAmplitudeMeters) — добавка к ε уровня, шаг которого их не представляет. */
  public p99AmplitudeBelowMeters(wavelengthMeters: number): number {
    let sum = 0
    for (let i = 0; i < MIDBAND_OCTAVES; i++) {
      if (this.wavelengthsMeters[i] < wavelengthMeters) sum += this.amplitudesMeters[i] * MIDBAND_P99
    }
    return this.strength * MIDBAND_ENVELOPE_MAX * sum
  }

  public sample(dirX: number, dirY: number, dirZ: number, e: MidbandEnvelope, out: MidbandSample): MidbandSample {
    out.heightMeters = 0
    out.tiltE = 0
    out.tiltN = 0
    if (this.strength === 0) return out

    const env = this.envelope(e)
    if (env === 0) return out

    // базис точки: E = normalize(UP × dir), N = dir × E; у полюса наклон не определён
    this.east.set(dirX, dirY, dirZ)
    this.east.crossVectors(UP, this.east)
    const eastLen = this.east.length()
    const polar = eastLen < 1e-4
    if (!polar) {
      this.east.divideScalar(eastLen)
      this.north.set(dirX, dirY, dirZ).cross(this.east)
    }

    const k = this.domainScale
    // домен и варп вдоль стока (w — направление стока в 3D)
    let px = dirX * k
    let py = dirY * k
    let pz = dirZ * k
    const wx = polar ? 0 : e.downE * this.east.x + e.downN * this.north.x
    const wy = polar ? 0 : e.downE * this.east.y + e.downN * this.north.y
    const wz = polar ? 0 : e.downE * this.east.z + e.downN * this.north.z
    const warpAmp = this.params.midbandWarp
    const wg = snoiseGrad3(px * WARP_FREQUENCY + WARP_OFFSET, py * WARP_FREQUENCY, pz * WARP_FREQUENCY, this.warpGrad)
    px += warpAmp * wx * wg.value
    py += warpAmp * wy * wg.value
    pz += warpAmp * wz * wg.value

    // производная домена по дуге вдоль E и N (единицы домена на метр): dir меняется на E/R за метр;
    // домен p = dir·R/λ₀ ⇒ ∂p/∂s = E/λ₀; варп — цепным правилом при замороженном w
    const invLambda = 1 / this.baseWavelengthMeters
    const wgE = polar ? 0 : (wg.dx * this.east.x + wg.dy * this.east.y + wg.dz * this.east.z) * WARP_FREQUENCY * invLambda
    const wgN = polar ? 0 : (wg.dx * this.north.x + wg.dy * this.north.y + wg.dz * this.north.z) * WARP_FREQUENCY * invLambda
    // ∂p/∂s_E = E/λ₀ + warp·w·wgE  (вектор в домене), аналогично N
    const dpEx = polar ? 0 : this.east.x * invLambda + warpAmp * wx * wgE
    const dpEy = polar ? 0 : this.east.y * invLambda + warpAmp * wy * wgE
    const dpEz = polar ? 0 : this.east.z * invLambda + warpAmp * wz * wgE
    const dpNx = polar ? 0 : this.north.x * invLambda + warpAmp * wx * wgN
    const dpNy = polar ? 0 : this.north.y * invLambda + warpAmp * wy * wgN
    const dpNz = polar ? 0 : this.north.z * invLambda + warpAmp * wz * wgN

    let height = 0
    let tE = 0
    let tN = 0
    let frequency = 1
    for (let i = 0; i < MIDBAND_OCTAVES; i++) {
      const g = snoiseGrad3(px * frequency, py * frequency, pz * frequency, this.grad)
      const sign = g.value >= 0 ? -1 : 1 // r = 1 − |n| ⇒ ∂r = −sign(n)·∂n
      const a = this.amplitudesMeters[i]
      height += a * (1 - Math.abs(g.value) - MIDBAND_RIDGE_MEAN)
      // ∂r/∂s = sign · (∇n · ∂q/∂s), ∂q/∂s = frequency · ∂p/∂s
      tE += a * sign * frequency * (g.dx * dpEx + g.dy * dpEy + g.dz * dpEz)
      tN += a * sign * frequency * (g.dx * dpNx + g.dy * dpNy + g.dz * dpNz)
      frequency *= MIDBAND_LACUNARITY
    }

    const scale = this.strength * env
    out.heightMeters = scale * height
    out.tiltE = polar ? 0 : scale * tE
    out.tiltN = polar ? 0 : scale * tN

    return out
  }
}
