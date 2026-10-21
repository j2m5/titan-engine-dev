import { Vector3 } from 'three'
import { snoiseGrad3, type NoiseGrad3 } from './simplexNoise3'
import type { MidbandParams } from './midbandParams'

export const MIDBAND_ASPECT = 0.03
export const MIDBAND_OCTAVES = 3
export const MIDBAND_LACUNARITY = 2
export const MIDBAND_ENVELOPE_MAX = 2
/** Та же полярная область, где раньше warp отключался скачком. */
export const MIDBAND_POLAR_COS = 1e-4

export function midbandPolarWeight(cosLat: number): number {
  if (cosLat >= MIDBAND_POLAR_COS) return 1
  const t = Math.max(0, cosLat / MIDBAND_POLAR_COS)
  return t * t * (3 - 2 * t)
}
/** Домен варпа — вдвое грубее базовой октавы. */
export const WARP_FREQUENCY = 0.5
/** Смещение домена варпа от домена октав — иначе варп коррелирует с гребнями. */
export const WARP_OFFSET = 31.7

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
 * Исторический амплитудный запас для LOD, при принятом |noise|≤1.
 * Для коллизий достаточно односторонней границы r−mean≤0.31 независимо
 * от |noise|; абсолютный диапазон legacy-шума этим коэффициентом не доказывается.
 */
export const MIDBAND_P99 = 0.7
/** Найквист по шагу вершин: до LO·λ октава целиком, от HI·λ её нет; между — smoothstep. */
export const MIDBAND_NYQUIST_LO = 0.5
export const MIDBAND_NYQUIST_HI = 1

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Вес октавы по шагу вершин уровня; step 0 — все октавы (потребители без уровня). */
export function midbandOctaveWeight(stepMeters: number, wavelengthMeters: number): number {
  if (stepMeters <= 0) return 1
  return 1 - smoothstep(MIDBAND_NYQUIST_LO, MIDBAND_NYQUIST_HI, stepMeters / wavelengthMeters)
}

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
  /** Σwᵢ/N — доля октав, представимых шагом уровня: 1 — вся полоса, 0 — полосы нет. */
  octaveWeightSum: number
  /** Огибающая точки (уклон/кривизна карты, с водным fade), [0, ENVELOPE_MAX]; 0 — полосы здесь нет. */
  envelope: number
}

const UP = new Vector3(0, 1, 0)

/**
 * Геометрия средней полосы (арка B): гребневой шум 3 октавы с варпом домена
 * вдоль стока, амплитуда A_i = ASPECT·λ_i, огибающая от уклона/кривизны карты.
 * Домен dir·R/λ₀ бесшовен на сфере. Наклоны — локальный градиент
 * (без попиксельного шума в шейдере: наклон уходит атрибутом midTilt).
 * Огибающая ≤ ENVELOPE_MAX. Глобального slopeBound нет: огибающая,
 * направление стока и разрывы legacy-шума не допускают прежнего допущения.
 * Коллизии используют интервалы значений через TerrainCollisionBounds.
 * Октавы взвешены по шагу вершин уровня (midbandOctaveWeight) и отсечены по cutoffWavelengthMeters.
 */
export class MidbandField {
  public readonly wavelengthsMeters: ReadonlyArray<number>
  public readonly amplitudesMeters: ReadonlyArray<number>
  public readonly maxAmplitudeMeters: number
  public readonly octaveCount: number
  /** Ширина затухания огибающей у уровня воды, метры; 0 — уровня нет (огибающая от карты не зависит). */
  public readonly waterFadeMeters: number
  private readonly domainScale: number
  private readonly strength: number
  private readonly east = new Vector3()
  private readonly north = new Vector3()
  private readonly grad: NoiseGrad3 = { value: 0, dx: 0, dy: 0, dz: 0 }
  private readonly warpGrad: NoiseGrad3 = { value: 0, dx: 0, dy: 0, dz: 0 }

  public constructor(
    private readonly params: MidbandParams,
    private readonly baseWavelengthMeters: number,
    radiusMeters: number,
    cutoffWavelengthMeters: number = 0
  ) {
    const wavelengths: number[] = []
    const amplitudes: number[] = []
    for (let i = 0; i < MIDBAND_OCTAVES; i++) {
      const lambda = baseWavelengthMeters / MIDBAND_LACUNARITY ** i
      // октава короче cutoff не представима даже самым мелким уровнем — шум по ней не считается
      if (lambda < cutoffWavelengthMeters) break
      wavelengths.push(lambda)
      amplitudes.push(MIDBAND_ASPECT * lambda) // амплитуда ∝ длине волны: A_i = ASPECT·λ_i
    }
    this.wavelengthsMeters = wavelengths
    this.amplitudesMeters = amplitudes
    this.octaveCount = wavelengths.length
    this.strength = params.midbandStrength
    this.domainScale = radiusMeters / baseWavelengthMeters
    const scale = this.strength * MIDBAND_ENVELOPE_MAX
    this.maxAmplitudeMeters = scale * amplitudes.reduce((s, a) => s + a * MIDBAND_P99, 0)
    this.waterFadeMeters = params.waterLevelMeters === null ? 0 : (params.midbandWaterFadeMeters ?? 2 * amplitudes[0])
  }

  public envelope(e: MidbandEnvelope, mapMeters: number): number {
    const slope = Math.min(1, Math.max(0, e.slopeTan / this.params.midbandSlopeRef))
    const ridge = this.params.midbandRidge * Math.max(0, e.curvature)
    const base = Math.min(MIDBAND_ENVELOPE_MAX, Math.max(0, this.params.midbandFlat + slope + ridge))
    if (this.params.waterLevelMeters === null) return base

    // у уреза полоса гаснет: кайма пены и мокрая кромка идут по карте, урез обязан совпасть с ними
    return base * smoothstep(0, this.waterFadeMeters, Math.abs(mapMeters - this.params.waterLevelMeters))
  }

  /** strength·ENVELOPE_MAX·Σ(1 − wᵢ)·Aᵢ·P99 — амплитуда той части полосы, которой на шаге уровня нет: добавка к ε. */
  public residualAmplitudeMeters(stepMeters: number): number {
    let sum = 0
    for (let i = 0; i < this.octaveCount; i++) {
      sum += (1 - midbandOctaveWeight(stepMeters, this.wavelengthsMeters[i])) * this.amplitudesMeters[i] * MIDBAND_P99
    }
    return this.strength * MIDBAND_ENVELOPE_MAX * sum
  }

  public sample(
    dirX: number,
    dirY: number,
    dirZ: number,
    e: MidbandEnvelope,
    mapMeters: number,
    out: MidbandSample,
    stepMeters: number = 0,
    /** Производная огибающей по дуге вдоль E/N, 1/м: член ∂env·B наклона (переменная огибающая). */
    envGradE: number = 0,
    envGradN: number = 0,
    /** Шаг родительского уровня (≥ stepMeters) и приёмник его суммы октав: тот же шум, один проход; < 0 / null — не нужна. */
    parentStepMeters: number = -1,
    parentOut: MidbandSample | null = null
  ): MidbandSample {
    out.heightMeters = 0
    out.tiltE = 0
    out.tiltN = 0
    // огибающая остаётся нулевой на всех ранних выходах: полосы в точке нет
    out.envelope = 0

    // родитель грубее ребёнка ⇒ wₚ ≤ w для каждой октавы: шум ребёнка покрывает родительский
    const wantParent = parentOut !== null && parentStepMeters >= 0
    let parentWeightSum = 0
    if (wantParent) {
      parentOut.heightMeters = 0
      parentOut.tiltE = 0
      parentOut.tiltN = 0
      parentOut.envelope = 0
      for (let i = 0; i < this.octaveCount; i++)
        parentWeightSum += midbandOctaveWeight(parentStepMeters, this.wavelengthsMeters[i])
      parentOut.octaveWeightSum = this.octaveCount > 0 ? parentWeightSum / this.octaveCount : 0
    }

    let weightSum = 0
    for (let i = 0; i < this.octaveCount; i++) weightSum += midbandOctaveWeight(stepMeters, this.wavelengthsMeters[i])
    out.octaveWeightSum = this.octaveCount > 0 ? weightSum / this.octaveCount : 0

    if (this.strength === 0) return out

    const cosLat = Math.hypot(dirX, dirZ)
    const polarWeight = midbandPolarWeight(cosLat)
    const baseEnv = this.envelope(e, mapMeters)
    const env = baseEnv * polarWeight
    if (env === 0) return out
    // шаг уровня грубее всех октав — полосы на нём нет
    if (weightSum === 0) return out

    out.envelope = env
    if (wantParent && parentWeightSum > 0) parentOut.envelope = env

    // базис точки: E = normalize(UP × dir), N = dir × E; у полюса наклон не определён
    this.east.set(dirX, dirY, dirZ)
    this.east.crossVectors(UP, this.east)
    const eastLen = this.east.length()
    const polar = eastLen === 0
    if (!polar) {
      this.east.divideScalar(eastLen)
      this.north.set(dirX, dirY, dirZ).cross(this.east)
    }

    const k = this.domainScale
    // домен и варп вдоль стока (w — направление стока в 3D)
    let px = dirX * k
    let py = dirY * k
    let pz = dirZ * k
    const wx = polar ? 0 : (e.downE * this.east.x + e.downN * this.north.x) * polarWeight
    const wy = polar ? 0 : (e.downE * this.east.y + e.downN * this.north.y) * polarWeight
    const wz = polar ? 0 : (e.downE * this.east.z + e.downN * this.north.z) * polarWeight
    const warpAmp = this.params.midbandWarp
    const wg = snoiseGrad3(px * WARP_FREQUENCY + WARP_OFFSET, py * WARP_FREQUENCY, pz * WARP_FREQUENCY, this.warpGrad)
    px += warpAmp * wx * wg.value
    py += warpAmp * wy * wg.value
    pz += warpAmp * wz * wg.value

    // производная домена по дуге вдоль E и N (единицы домена на метр): dir меняется на E/R за метр;
    // домен p = dir·R/λ₀ ⇒ ∂p/∂s = E/λ₀; варп — цепным правилом при замороженном w
    const invLambda = 1 / this.baseWavelengthMeters
    const wgE = polar
      ? 0
      : (wg.dx * this.east.x + wg.dy * this.east.y + wg.dz * this.east.z) * WARP_FREQUENCY * invLambda
    const wgN = polar
      ? 0
      : (wg.dx * this.north.x + wg.dy * this.north.y + wg.dz * this.north.z) * WARP_FREQUENCY * invLambda
    // ∂p/∂s_E = E/λ₀ + warp·w·wgE  (вектор в домене), аналогично N
    const dpEx = polar ? 0 : this.east.x * invLambda + warpAmp * wx * wgE
    const dpEy = polar ? 0 : this.east.y * invLambda + warpAmp * wy * wgE
    const dpEz = polar ? 0 : this.east.z * invLambda + warpAmp * wz * wgE
    let dpNx = polar ? 0 : this.north.x * invLambda + warpAmp * wx * wgN
    let dpNy = polar ? 0 : this.north.y * invLambda + warpAmp * wy * wgN
    let dpNz = polar ? 0 : this.north.z * invLambda + warpAmp * wz * wgN

    if (cosLat < MIDBAND_POLAR_COS && !polar) {
      const t = cosLat / MIDBAND_POLAR_COS
      // dc/ds_N = -dirY/R. В центре env=0 и ранний выход выше,
      // поэтому деление на вес здесь не требуется.
      const weightGradN = (-dirY * 6 * t * (1 - t)) / (MIDBAND_POLAR_COS * this.domainScale * this.baseWavelengthMeters)
      envGradE *= polarWeight
      envGradN = envGradN * polarWeight + baseEnv * weightGradN
      const warpWeightGrad = warpAmp * wg.value * weightGradN
      dpNx += (e.downE * this.east.x + e.downN * this.north.x) * warpWeightGrad
      dpNy += (e.downE * this.east.y + e.downN * this.north.y) * warpWeightGrad
      dpNz += (e.downE * this.east.z + e.downN * this.north.z) * warpWeightGrad
    }

    let height = 0
    let tE = 0
    let tN = 0
    let hP = 0
    let tEP = 0
    let tNP = 0
    let frequency = 1
    for (let i = 0; i < this.octaveCount; i++) {
      const w = midbandOctaveWeight(stepMeters, this.wavelengthsMeters[i])
      const wp = wantParent ? midbandOctaveWeight(parentStepMeters, this.wavelengthsMeters[i]) : 0
      if (w > 0) {
        const g = snoiseGrad3(px * frequency, py * frequency, pz * frequency, this.grad)
        const sign = g.value >= 0 ? -1 : 1 // r = 1 − |n| ⇒ ∂r = −sign(n)·∂n
        const a = w * this.amplitudesMeters[i]
        height += a * (1 - Math.abs(g.value) - MIDBAND_RIDGE_MEAN)
        // ∂r/∂s = sign · (∇n · ∂q/∂s), ∂q/∂s = frequency · ∂p/∂s
        tE += a * sign * frequency * (g.dx * dpEx + g.dy * dpEy + g.dz * dpEz)
        tN += a * sign * frequency * (g.dx * dpNx + g.dy * dpNy + g.dz * dpNz)
        if (wp > 0) {
          const ap = wp * this.amplitudesMeters[i]
          hP += ap * (1 - Math.abs(g.value) - MIDBAND_RIDGE_MEAN)
          tEP += ap * sign * frequency * (g.dx * dpEx + g.dy * dpEy + g.dz * dpEz)
          tNP += ap * sign * frequency * (g.dx * dpNx + g.dy * dpNy + g.dz * dpNz)
        }
      }
      frequency *= MIDBAND_LACUNARITY
    }

    const scale = this.strength * env
    out.heightMeters = scale * height
    // Производная strength·env·B при замороженном направлении стока: env·∂B + ∂env·B.
    out.tiltE = polar ? 0 : scale * tE + this.strength * height * envGradE
    out.tiltN = polar ? 0 : scale * tN + this.strength * height * envGradN

    if (wantParent && parentWeightSum > 0) {
      parentOut.heightMeters = scale * hP
      parentOut.tiltE = polar ? 0 : scale * tEP + this.strength * hP * envGradE
      parentOut.tiltN = polar ? 0 : scale * tNP + this.strength * hP * envGradN
    }

    return out
  }
}
