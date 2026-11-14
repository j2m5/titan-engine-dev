import type { Vector3 } from 'three'
import type { MidbandParams } from './midbandParams'
import { midbandOctaveWeight, midbandPolarWeight } from './midbandField'
import { TERRAIN_PATCH_SEGMENTS } from './cubeSphere'
import type { ValueRange } from './terrainRange'
import {
  BEDROCK_SHAPE as S,
  bedrockProfile,
  bedrockProfileDerivative,
  bedrockProfileLipschitz,
  bedrockProfileCurvature,
  bedrockPhaseWarp,
  bedrockJointDerivative
} from './bedrockShape'

export { bedrockProfile, bedrockProfileDerivative } from './bedrockShape'

/** The physical bedrock spectrum stays fixed if the render LOD cap changes again. */
const BEDROCK_MODEL_LEVEL = 10

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

type Sample = { heightMeters: number; tiltE: number; tiltN: number; mapSlopeScale?: number }

/** Analytic bedrock displacement, shared by the mesh, canonical field and interval collision queries. */
export class BedrockField {
  public readonly maxAmplitudeMeters: number
  public readonly canonicalStepMeters: number
  private readonly phaseScale: number
  private readonly warpSlopeBound: number
  private readonly warpHessianBound: number
  private readonly profileLipschitz: number

  public constructor(
    private readonly params: MidbandParams,
    private readonly radiusMeters: number
  ) {
    this.maxAmplitudeMeters = 0.5 * params.bedrockStrength * params.bedrockStepMeters
    this.canonicalStepMeters = (2 * Math.PI * radiusMeters) / (4 * 2 ** BEDROCK_MODEL_LEVEL * TERRAIN_PATCH_SEGMENTS)
    this.phaseScale = (2 * Math.PI * radiusMeters) / S.warpPeriod
    this.warpSlopeBound =
      (this.phaseScale / radiusMeters) * (S.warpA + S.warpB * S.warpRatio) +
      ((params.bedrockWeathering * 4) / S.jointPeriod) * (S.jointA + S.jointB * S.jointRatio)
    this.warpHessianBound =
      ((2 * Math.PI) / S.warpPeriod) ** 2 * (S.warpA + S.warpB * S.warpRatio ** 2) +
      ((params.bedrockWeathering * 4) / (S.jointRound * S.jointPeriod ** 2)) * (S.jointA + S.jointB * S.jointRatio ** 2)
    this.profileLipschitz = bedrockProfileLipschitz(params.bedrockWeathering)
  }

  private waterWeight(mapMeters: number): number {
    return this.params.waterLevelMeters === null
      ? 1
      : smooth(0, this.params.bedrockStepMeters, Math.abs(mapMeters - this.params.waterLevelMeters))
  }

  private weight(slopeTan: number, stepMeters: number): number {
    const wavelength =
      this.params.bedrockStepMeters /
      (3 * (Math.max(0, slopeTan) + this.params.bedrockStepMeters * this.warpSlopeBound))
    return midbandOctaveWeight(Math.max(stepMeters, this.canonicalStepMeters), wavelength)
  }

  public envelope(slopeTan: number, mapMeters: number, cosLat: number, stepMeters = 0): number {
    return (
      smooth(0.25, 0.65, slopeTan) *
      this.waterWeight(mapMeters) *
      midbandPolarWeight(cosLat) *
      this.weight(slopeTan, stepMeters)
    )
  }

  /** Near-field apron coverage, shared by mesh deposits and the fragment material. */
  public talusCoverage(dir: Vector3, mapMeters: number, slopeTan: number): number {
    const phase = mapMeters / this.params.bedrockStepMeters + this.warp(dir)
    const p = phase - Math.floor(phase)
    const apron = smooth(S.footStart, 0.18, p) * (1 - smooth(0.34, S.footStart + S.footWidth, p))
    return apron * this.envelope(slopeTan, mapMeters, Math.hypot(dir.x, dir.z)) *
      this.params.bedrockWeathering * Math.min(1, this.params.bedrockStrength / 0.45)
  }

  /** Worst missing displacement; the canonical layer is itself filtered to its fixed finest mesh. */
  public residualAmplitudeMeters(stepMeters: number): number {
    return stepMeters <= this.canonicalStepMeters * (1 + 1e-12) ? 0 : this.maxAmplitudeMeters
  }

  private warp(dir: Vector3): number {
    return bedrockPhaseWarp(dir.x, dir.y, dir.z, this.radiusMeters, this.params.bedrockWeathering)
  }

  public envelopeRange(
    map: ValueRange,
    slope: ValueRange,
    minCos: number,
    maxCos: number,
    out: ValueRange
  ): ValueRange {
    const h = this.params.bedrockStepMeters
    let waterLo = 1,
      waterHi = 1
    if (this.params.waterLevelMeters !== null) {
      const a = map.min - this.params.waterLevelMeters,
        b = map.max - this.params.waterLevelMeters
      waterLo = smooth(0, h, a > 0 ? a : b < 0 ? -b : 0)
      waterHi = smooth(0, h, Math.max(Math.abs(a), Math.abs(b)))
    }
    out.min = smooth(0.25, 0.65, slope.min) * this.weight(slope.max, 0) * waterLo * midbandPolarWeight(minCos)
    out.max = smooth(0.25, 0.65, slope.max) * this.weight(slope.min, 0) * waterHi * midbandPolarWeight(maxCos)
    return out
  }

  /** Positive triangle interpolation error at the settled canonical mesh scale. */
  public sagAllowance(
    map: ValueRange,
    slope: ValueRange,
    center: Vector3,
    chord: number,
    minCos: number,
    maxCos: number,
    mapSlopeUpper: number,
    mapSagUpper: number
  ): number {
    const envelope = this.envelopeRange(map, slope, minCos, maxCos, { min: 0, max: 0 })
    if (envelope.max === 0) return 0
    const h = this.params.bedrockStepMeters
    const phase = (map.min + map.max) / (2 * h) + this.warp(center)
    const delta = (map.max - map.min) / (2 * h) + chord * this.radiusMeters * this.warpSlopeBound + 1e-9
    const curvature = bedrockProfileCurvature(phase, delta, this.params.bedrockWeathering)
    // Equal-angle cubeface stretch sqrt(4/3), then the cell diagonal sqrt(2).
    const diameter = this.canonicalStepMeters * Math.sqrt(8 / 3)
    const variance = ((mapSlopeUpper / h + this.warpSlopeBound) * diameter) ** 2 / 3
    const warpError =
      (this.warpHessianBound * diameter ** 2) / 6 +
      (2 * this.warpSlopeBound * diameter ** 2 * (1 + mapSlopeUpper)) / Math.max(1, this.radiusMeters + map.min)
    // DEM kinks use the existing map sag bound; coverage variation also covers water/polar/LOD fades.
    const error =
      this.params.bedrockStrength *
      h *
      (envelope.max *
        (this.profileLipschitz * (mapSagUpper / h + warpError) + (curvature === 0 ? 0 : (curvature * variance) / 2)) +
        0.5 * (envelope.max - envelope.min))
    return Math.min(2 * this.maxAmplitudeMeters * envelope.max, error + 1e-6)
  }

  /** Add height and its derivative. Coverage already includes the selected LOD weight. */
  public addSample(
    dir: Vector3,
    mapMeters: number,
    envelope: number,
    mapE: number,
    mapN: number,
    envelopeE: number,
    envelopeN: number,
    out: Sample,
    withTilt = true,
    splitMapSlope = false
  ): void {
    if (envelope === 0 || this.params.bedrockStrength === 0) return
    const h = this.params.bedrockStepMeters
    const phase = mapMeters / h + this.warp(dir)
    const profile = bedrockProfile(phase, this.params.bedrockWeathering)
    const amplitude = h * this.params.bedrockStrength
    out.heightMeters += amplitude * envelope * profile
    if (!withTilt) return

    const cosLat = Math.hypot(dir.x, dir.z)
    if (cosLat === 0) return
    const ex = dir.z / cosLat,
      ez = -dir.x / cosLat
    const nx = (-dir.y * dir.x) / cosLat,
      ny = cosLat,
      nz = (-dir.y * dir.z) / cosLat
    const a = this.phaseScale * (0.8 * dir.x + 0.48 * dir.y - 0.36 * dir.z)
    const b = this.phaseScale * S.warpRatio * (-0.6 * dir.x + 0.8 * dir.y) + 2.7
    const da = (S.warpA * this.phaseScale * Math.cos(a)) / this.radiusMeters
    const db = (S.warpB * this.phaseScale * S.warpRatio * Math.cos(b)) / this.radiusMeters
    let warpE = da * (0.8 * ex - 0.36 * ez) + db * (-0.6 * ex)
    let warpN = da * (0.8 * nx + 0.48 * ny - 0.36 * nz) + db * (-0.6 * nx + 0.8 * ny)
    if (this.params.bedrockWeathering > 0) {
      const j = this.radiusMeters / S.jointPeriod
      const dc =
        ((this.params.bedrockWeathering * S.jointA) / S.jointPeriod) *
        bedrockJointDerivative(j * (0.36 * dir.x - 0.48 * dir.y + 0.8 * dir.z))
      const dd =
        ((this.params.bedrockWeathering * S.jointB * S.jointRatio) / S.jointPeriod) *
        bedrockJointDerivative(j * S.jointRatio * (-0.8 * dir.x - 0.6 * dir.y) + 0.41)
      warpE += dc * (0.36 * ex + 0.8 * ez) + dd * (-0.8 * ex)
      warpN += dc * (0.36 * nx - 0.48 * ny + 0.8 * nz) + dd * (-0.8 * nx - 0.6 * ny)
    }
    const derivative = bedrockProfileDerivative(phase, this.params.bedrockWeathering)
    // Keep the DEM response multiplicative in the shader: its base comes from
    // a filtered slope texture, so subtracting a local DEM derivative can flip it.
    if (splitMapSlope) out.mapSlopeScale = this.params.bedrockStrength * envelope * derivative
    out.tiltE += amplitude * (envelopeE * profile + envelope * derivative * ((splitMapSlope ? 0 : mapE / h) + warpE))
    out.tiltN += amplitude * (envelopeN * profile + envelope * derivative * ((splitMapSlope ? 0 : mapN / h) + warpN))
  }

  /** Signed range over a spherical cap; shrinks to the exact point value, including negative ledges. */
  public range(
    map: ValueRange,
    slope: ValueRange,
    center: Vector3,
    chord: number,
    minCos: number,
    maxCos: number,
    out: ValueRange
  ): ValueRange {
    const h = this.params.bedrockStepMeters
    const phase = (map.min + map.max) / (2 * h) + this.warp(center)
    const delta =
      (map.max - map.min) / (2 * h) + chord * this.radiusMeters * this.warpSlopeBound + 1e-12 * (1 + Math.abs(phase))
    const profile = bedrockProfile(phase, this.params.bedrockWeathering)
    const lo = Math.max(-0.5, profile - this.profileLipschitz * delta)
    const hi = Math.min(0.5, profile + this.profileLipschitz * delta)
    // Slope gate increases while sampling weight decreases: bound each separately.
    const envelope = this.envelopeRange(map, slope, minCos, maxCos, { min: 0, max: 0 })
    const envLo = envelope.min,
      envHi = envelope.max
    const amplitude = h * this.params.bedrockStrength
    const pad = 1e-8 + 1e-12 * amplitude
    out.min = amplitude * lo * (lo < 0 ? envHi : envLo) - pad
    out.max = amplitude * hi * (hi > 0 ? envHi : envLo) + pad
    return out
  }
}
