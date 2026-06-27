import { Matrix4, NormalBlending, Uniform, Vector3 } from 'three'
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
  }

  public updateMaterial(): void {
    this.uniforms.uTime.value = threeJS.clock.getElapsedTime()
  }

  public resetMaterial(): void {
    this.uniforms.uTime.value = 0
  }
}

export { NebulaRaymarchMaterial }
