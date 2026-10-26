import {
  AddEquation,
  Color,
  CustomBlending,
  GLSL3,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGFormat,
  Texture,
  Uniform,
  UnsignedByteType,
  Vector3
} from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchShader } from './NebulaRaymarchShader'
import { applyDensityUniforms } from '@/core/renderables/Nebula/material/densityUniforms'
import { createNebulaBlueNoiseTexture } from './NebulaBlueNoise'

class NebulaRaymarchMaterial extends AbstractShaderMaterial {
  private readonly blueNoise = createNebulaBlueNoiseTexture()

  public constructor(params: NebulaParams) {
    super()
    const { uniforms, vertexShader, fragmentShader, defines } = new NebulaRaymarchShader().toJSON()
    this.uniforms = {
      ...uniforms,
      uBlueNoise: new Uniform(this.blueNoise),
      uCameraLocal: new Uniform(new Vector3())
    }
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines ?? {}
    // GLSL3 so the marcher can sample the baked sampler3D (matches the codebase's
    // atmosphere/black-hole shaders). The non-baked path is identical math.
    this.glslVersion = GLSL3

    if (params.quality.bake3DTexture) {
      // Use procedural density until the entire queued texture is ready.
      this.defines = { ...this.defines, NEB_BAKED: '' }
      this.uniforms.uDensityTex = new Uniform(null)
      this.uniforms.uDensityReady = new Uniform(0)
    }

    this.transparent = true
    // Neither writes nor tests depth: the material is drawn by DepthVolumePass after
    // the scene and cuts its ray at the scene depth itself (SceneDepth chunk). The
    // hardware test was a binary "lesser evil" — hard cutouts against a black hole's
    // bounding sphere, or fog over everything.
    this.depthWrite = false
    this.depthTest = false
    // The shader outputs PREMULTIPLIED (accum, alpha), so composite premultiplied
    // (One, OneMinusSrcAlpha) = correct front-to-back "over". This (a) avoids the
    // alpha double-apply NormalBlending would cause (thin regions stay correct),
    // and (b) composites the shader's premultiplied LOD mix exactly once.
    this.blending = CustomBlending
    this.blendEquation = AddEquation
    this.blendSrc = OneFactor
    this.blendDst = OneMinusSrcAlphaFactor

    this.setUniformsFromParams(params)
  }

  public setUniformsFromParams(params: NebulaParams): void {
    this.temporalRevision++
    const u = this.uniforms
    // density-field uniforms (shared with the 3D-bake material)
    applyDensityUniforms(u, params)

    u.uMaxSteps.value = params.quality.maxSteps
    u.uLightSteps.value = params.quality.lightSteps
    u.uEmissiveIntensity.value = params.palette.emissiveIntensity
    u.uDensityScale.value = params.density
    u.uGasAbsorption.value = params.gas.absorption

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
    u.uRadialMix.value = pal.radialMix
    u.uInnerColor.value.copy(pal.innerColor)
    u.uOuterColor.value.copy(pal.outerColor)

    u.uDustColor.value.copy(params.dust.color)
    u.uDustStrength.value = params.dust.strength

    u.uScatterStrength.value = params.lighting.scatterStrength
    u.uPhaseHG.value = params.lighting.anisotropy !== null ? 1 : 0
    u.uAnisotropy.value = params.lighting.anisotropy ?? 0
    u.uShadowStrength.value = params.lighting.shadowStrength
    u.uAmbient.value = params.lighting.ambient
    u.uHasStar.value = params.lighting.starPosition ? 1 : 0
    u.uLightTint.value = params.lighting.color ? 1 : 0
    if (params.lighting.color) u.uLightColor.value.copy(params.lighting.color)
    u.uLightFalloff.value = params.lighting.falloffRadius
  }

  /** Publish a complete field, or return to the live fallback on invalidation. */
  public setBakedDensityTexture(texture: Texture | null): void {
    if (this.uniforms.uDensityTex) {
      if (this.uniforms.uDensityTex.value !== texture) this.temporalRevision++
      this.uniforms.uDensityTex.value = texture
      this.uniforms.uDensityReady.value = texture ? 1 : 0
      // Only normalized RG8 guarantees samples in [0,1]. In particular, an
      // external floating-point field may exceed one even when it is ready.
      this.uniforms.uDensityUnitRange.value = texture?.type === UnsignedByteType && texture.format === RGFormat &&
        (texture.internalFormat === null || texture.internalFormat === 'RG8') ? 1 : 0
      const ready = texture !== null
      if (ready !== (this.defines.NEB_BAKED_ONLY !== undefined)) {
        // Two cached programs: live fallback and texture-only sampling. Replacing
        // a ready field only updates uniforms; it must not request recompilation.
        if (ready) this.defines.NEB_BAKED_ONLY = ''
        else delete this.defines.NEB_BAKED_ONLY
        this.needsUpdate = true
      }
    }
  }

  /** Content changes must not reuse an image of the previous density field. */
  public temporalRevision = 0

  // Параметр опционален, чтобы сохранить совместимость с сигнатурой базового
  // AbstractShaderMaterial.updateMaterial(): void, которую разделяют остальные
  // материалы (вызывается и без аргументов, напр. ResourceObserver)
  public updateMaterial(elapsed: number = 0): void {
    this.uniforms.uTime.value = elapsed
  }

  public resetMaterial(): void {
    this.uniforms.uTime.value = 0
  }

  public override dispose(): void {
    this.blueNoise.dispose()
    super.dispose()
  }
}

export { NebulaRaymarchMaterial }
