import { Color, Matrix4, NormalBlending, Uniform, Vector3, Vector4 } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchShader } from './NebulaRaymarchShader'
import { threeJS } from '@/core/graphic/ThreeJS'

class NebulaRaymarchMaterial extends AbstractShaderMaterial {
  public constructor(params: NebulaParams) {
    super()
    const { uniforms, vertexShader, fragmentShader, defines } = new NebulaRaymarchShader().toJSON()
    this.uniforms = {
      ...uniforms,
      uInvModelMatrix: new Uniform(new Matrix4()),
      uCameraWorld: new Uniform(new Vector3())
    }
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines ?? {}

    this.transparent = true
    this.depthWrite = false
    this.depthTest = true
    // The shader outputs premultiplied (accum, alpha); over-compositing keeps the
    // emission additive in dense regions while letting transmittance reveal what
    // is behind. NormalBlending with premultiplied alpha = correct front-to-back.
    this.blending = NormalBlending

    this.setUniformsFromParams(params)
  }

  public setUniformsFromParams(params: NebulaParams): void {
    const u = this.uniforms
    u.uMaxSteps.value = params.quality.maxSteps
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
    u.uEmissiveIntensity.value = params.palette.emissiveIntensity

    const pal = params.palette
    const lastStop = pal.stops[pal.stops.length - 1]?.color ?? new Color(0xffffff)
    u.uPalette0.value.copy(pal.stops[0]?.color ?? new Color(0x000000))
    u.uPalette1.value.copy(pal.stops[1]?.color ?? lastStop)
    u.uPalette2.value.copy(pal.stops[2]?.color ?? lastStop)
    u.uPalette3.value.copy(pal.stops[3]?.color ?? lastStop)
    u.uPaletteT.value.set(
      pal.stops[0]?.t ?? 0,
      pal.stops[1]?.t ?? 0.45,
      pal.stops[2]?.t ?? 0.8,
      pal.stops[3]?.t ?? 1
    )
    u.uSecondaryColor.value.copy(pal.secondary)
    u.uSecondaryThreshold.value = pal.secondaryThreshold

    u.uDustColor.value.copy(params.dust.color)
    u.uDustStrength.value = params.dust.strength
    u.uDustThreshold.value = params.dust.threshold

    u.uScatterStrength.value = params.lighting.scatterStrength
    u.uAmbient.value = params.lighting.ambient
    u.uHasStar.value = params.lighting.starPosition ? 1 : 0

    u.uWorleyStrength.value = params.noise.worleyStrength
    this.packLobes(params)
  }

  /** Pack lobes/cavities into the fixed-size (8) uniform arrays; excess is dropped. */
  private packLobes(params: NebulaParams): void {
    const u = this.uniforms
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

  public updateMaterial(): void {
    this.uniforms.uTime.value = threeJS.clock.getElapsedTime()
  }

  public resetMaterial(): void {
    this.uniforms.uTime.value = 0
  }
}

export { NebulaRaymarchMaterial }
