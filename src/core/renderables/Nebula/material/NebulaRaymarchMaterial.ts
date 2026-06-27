import {
  AddEquation,
  Color,
  CustomBlending,
  GLSL3,
  Matrix4,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Texture,
  Uniform,
  Vector3
} from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchShader } from './NebulaRaymarchShader'
import { applyDensityUniforms } from '@/core/renderables/Nebula/material/densityUniforms'
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
    // GLSL3 so the marcher can sample the baked sampler3D (matches the codebase's
    // atmosphere/black-hole shaders). The non-baked path is identical math.
    this.glslVersion = GLSL3

    if (params.quality.bake3DTexture) {
      // compile the texture-sampling branch; Nebula bakes the field and assigns
      // the texture via setBakedDensityTexture before the first render.
      this.defines = { ...this.defines, NEB_BAKED: '' }
      this.uniforms.uDensityTex = new Uniform(null)
    }

    this.transparent = true
    this.depthWrite = false
    this.depthTest = params.quality.depthTest
    // The shader outputs PREMULTIPLIED (accum, alpha), so composite premultiplied
    // (One, OneMinusSrcAlpha) = correct front-to-back "over". This (a) avoids the
    // alpha double-apply NormalBlending would cause (thin regions stay correct),
    // and (b) makes uOpacityScale a LINEAR fade, so the raymarch<->impostor
    // crossfade conserves energy (the impostor uses the same blend equation).
    this.blending = CustomBlending
    this.blendEquation = AddEquation
    this.blendSrc = OneFactor
    this.blendDst = OneMinusSrcAlphaFactor

    this.setUniformsFromParams(params)
  }

  public setUniformsFromParams(params: NebulaParams): void {
    const u = this.uniforms
    // density-field uniforms (shared with the 3D-bake material)
    applyDensityUniforms(u, params)

    u.uMaxSteps.value = params.quality.maxSteps
    u.uEmissiveIntensity.value = params.palette.emissiveIntensity
    u.uDensityScale.value = params.density

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
  }

  /** Bind the precomputed 3D density field (only meaningful when NEB_BAKED). */
  public setBakedDensityTexture(texture: Texture): void {
    if (this.uniforms.uDensityTex) this.uniforms.uDensityTex.value = texture
  }

  public updateMaterial(): void {
    this.uniforms.uTime.value = threeJS.clock.getElapsedTime()
  }

  public resetMaterial(): void {
    this.uniforms.uTime.value = 0
  }
}

export { NebulaRaymarchMaterial }
