import { simplexNoise3 } from './simplexNoise3'
import { seedOffset, type ProceduralSurfaceParams } from './proceduralSurfaceParams'

/**
 * fBM-поле облика по единичному направлению: Σ gainᵏ·snoise(dir·f·lacᵏ + offset),
 * нормировка на Σ gainᵏ, контраст sign(v)·|v|^contrast. Значение ≈ [-1,1].
 * Формула зеркалится GLSL-чанком ProceduralSurface — менять только синхронно.
 */
export function proceduralField(dirX: number, dirY: number, dirZ: number, params: ProceduralSurfaceParams): number {
  const offset = seedOffset(params.seed)
  let amplitude = 1
  let frequency = params.frequencyPerRadius
  let sum = 0
  let norm = 0

  for (let k = 0; k < params.octaves; k++) {
    sum += amplitude * simplexNoise3(
      dirX * frequency + offset.x,
      dirY * frequency + offset.y,
      dirZ * frequency + offset.z
    )
    norm += amplitude
    amplitude *= params.gain
    frequency *= params.lacunarity
  }

  const v = sum / norm
  return Math.sign(v) * Math.pow(Math.abs(v), params.contrast)
}
