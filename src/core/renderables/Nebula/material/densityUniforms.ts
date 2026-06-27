import { IUniform, Vector4 } from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'

/**
 * Set the density-FIELD uniforms (boundary / noise / lobes / cavities / Worley) on a
 * uniforms record. Shared by the live raymarch material and the 3D-bake material so
 * the baked field is byte-for-byte the same function as the live one. Excludes
 * march-only uniforms (steps, palette/dust/light, density absorption, opacity, time).
 */
export function applyDensityUniforms(u: Record<string, IUniform>, params: NebulaParams): void {
  u.uShape.value = params.shape === 'disk' ? 1 : 0
  u.uInvAxis.value.set(
    1 / Math.max(1e-4, params.axisRatios.x),
    1 / Math.max(1e-4, params.axisRatios.y),
    1 / Math.max(1e-4, params.axisRatios.z)
  )
  u.uEdgeFalloff.value = params.edgeFalloff
  u.uOctaves.value = params.noise.octaves
  u.uFrequency.value = params.noise.frequency
  u.uLacunarity.value = params.noise.lacunarity
  u.uGain.value = params.noise.gain
  u.uWarpStrength.value = params.noise.warpStrength
  u.uRidged.value = params.noise.ridged
  u.uContrast.value = params.noise.contrast
  u.uWorleyStrength.value = params.noise.worleyStrength

  const lobeData = u.uLobeData.value as Vector4[]
  const lobeWeight = u.uLobeWeight.value as number[]
  const cavData = u.uCavityData.value as Vector4[]
  const cavStrength = u.uCavityStrength.value as number[]

  const lobes = params.lobes.slice(0, 8)
  const cavities = params.cavities.slice(0, 8)
  u.uLobeCount.value = lobes.length
  u.uCavityCount.value = cavities.length

  for (let i = 0; i < 8; i++) {
    const lobe = lobes[i]
    if (lobe) {
      lobeData[i].set(lobe.center.x, lobe.center.y, lobe.center.z, lobe.radius)
      lobeWeight[i] = lobe.weight
    } else {
      lobeData[i].set(0, 0, 0, 1)
      lobeWeight[i] = 0
    }

    const cav = cavities[i]
    if (cav) {
      cavData[i].set(cav.center.x, cav.center.y, cav.center.z, cav.radius)
      cavStrength[i] = cav.strength
    } else {
      cavData[i].set(0, 0, 0, 1)
      cavStrength[i] = 0
    }
  }
}
