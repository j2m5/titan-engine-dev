import type { AtmosphereShadow } from '@takram/three-atmosphere'
import type { CloudsEffect } from '@takram/three-clouds'
import {
  BasicDepthPacking,
  Data3DTexture,
  HalfFloatType,
  PerspectiveCamera,
  Texture,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import { cloudLayerAltitude } from '@/core/clouds/scene/CloudFrame'
import type { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { bindCloudAppearance, type CloudAppearanceBinding } from '@/core/clouds/appearance/cloudAppearance'
import type { CloudQualityProfile, CloudQuality } from '@/core/clouds/SceneCloudConfig'
import type { SceneCloudDepthFrame } from '@/core/graphic/clouds/SceneCloudDepth'
import type { AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { createPlanetCloudEffect, toTakramAtmosphere } from './planetCloudAdapter'
import { createCloudTextures } from './cloudTextures'
import { setCloudQuality } from './cloudQuality'
import { prepareCloudTargets } from './prepareCloudTargets'
import { installSceneCloudPatches, type SceneCloudPatchBinding } from './sceneCloudLighting'

export interface SceneCloudOutput {
  frame: CloudFrame
  atmosphereActorId: number
  atmosphereGeneration: number
  atmosphereBottomRadiusMeters: number
  historyGeneration: number
  overlay: Texture
  shadow: AtmosphereShadow | null
  stbn: Data3DTexture
}

/** Pinned CSM unprojects z=1; reject its exact nonfinite boundary without changing scene projection. */
export function assertSceneCloudProjection(camera: PerspectiveCamera): void {
  const inverse = camera.projectionMatrixInverse
  if (!inverse.elements.every(Number.isFinite) || inverse.determinant() === 0)
    throw new Error('Unsupported scene cloud camera projection: nonfinite or singular inverse')
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      const corner = new Vector4(x, y, 1, 1).applyMatrix4(inverse)
      if (corner.w === 0 || ![corner.x / corner.w, corner.y / corner.w, corner.z / corner.w].every(Number.isFinite))
        throw new Error('Unsupported scene cloud camera projection: nonfinite shadow far-frustum')
    }
}

/** Owns one public CloudsEffect and noise set. Prepared source textures and scene LUTs are borrowed. */
export class SceneCloudBackend {
  private effect!: CloudsEffect
  private readonly noise: ReturnType<typeof createCloudTextures>
  private appearance!: CloudAppearanceBinding
  private patches!: SceneCloudPatchBinding
  private restoreTargets!: () => void
  private initialized = false
  private disposed = false
  private historyGeneration = 0
  private atmosphereGeneration: number
  private width: number
  private height: number

  public constructor(
    private frame: CloudFrame,
    private readonly atmosphere: AtmosphereEntry,
    private readonly prepared: ReturnType<typeof prepareCloudSource>,
    private readonly profile: CloudQualityProfile,
    private readonly quality: CloudQuality
  ) {
    if (!atmosphere.ready) throw new Error('Scene cloud atmosphere LUT is not ready')
    this.atmosphereGeneration = atmosphere.generation
    this.width = frame.viewport.x
    this.height = frame.viewport.y
    this.noise = createCloudTextures()
    try {
      this.createEffect()
    } catch (error) {
      this.noise.dispose()
      throw error
    }
  }

  private createEffect(): void {
    const effect = createPlanetCloudEffect(this.frame.camera, toTakramAtmosphere(this.atmosphere.config))
    this.effect = effect
    try {
      const config = structuredClone(this.prepared.config)
      config.layers[0].baseAltitudeMeters = cloudLayerAltitude(
        this.frame.datumRadiusMeters,
        this.atmosphere.config.bottomRadius * 1000,
        config.layers[0].baseAltitudeMeters
      )
      this.appearance = bindCloudAppearance(effect, config, this.prepared.textures)
      this.patches = installSceneCloudPatches(effect)
      this.restoreTargets = prepareCloudTargets(effect)
      setCloudQuality(effect, this.profile, this.quality)
      effect.haze = false
      effect.lightShafts = false
      effect.skipRendering = true
      effect.shapeTexture = this.noise.shape
      effect.shapeDetailTexture = this.noise.detail
      effect.stbnTexture = this.noise.noise
      // Main LUTs contain linear transmittance and combined Rayleigh/Mie scattering.
      effect.singleMieScatteringTexture = null
      effect.transmittanceTexture = this.atmosphere.lut.transmittance
      // WebGL3DRenderTarget owns a GPU 3D Texture; upstream's setter is typed Data3DTexture.
      effect.scatteringTexture = this.atmosphere.lut.scattering as Data3DTexture
      effect.irradianceTexture = this.atmosphere.lut.irradiance
      effect.setSize(this.width, this.height)
      this.initialized = false
    } catch (error) {
      this.releaseEffect()
      throw error
    }
  }

  public render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    frame: CloudFrame,
    depth: SceneCloudDepthFrame,
    atmosphere: AtmosphereEntry
  ): SceneCloudOutput {
    if (this.disposed) throw new Error('Scene cloud backend is disposed')
    if (!atmosphere.ready || atmosphere !== this.atmosphere || atmosphere.generation !== this.atmosphereGeneration)
      throw new Error('Scene cloud atmosphere identity is stale or LUT is not ready')
    if (depth.serial !== frame.serial || !depth.viewport.equals(frame.viewport))
      throw new Error('Scene cloud depth does not belong to this frame')
    if (inputBuffer.texture === depth.texture || inputBuffer.depthTexture === depth.texture)
      throw new Error('Scene cloud input target must be independent of sampled depth')
    if (!renderer.extensions.has('EXT_color_buffer_float'))
      throw new Error('Scene cloud backend requires renderable floating point textures')
    assertSceneCloudProjection(frame.camera)
    this.frame = frame
    this.setSize(frame.viewport.x, frame.viewport.y)
    const effect = this.effect
    effect.mainCamera = frame.camera
    effect.sunDirection.copy(frame.sunDirection)
    this.appearance.setPlanetRotation(frame.planetRotation)
    this.patches.update(frame, depth, atmosphere)
    effect.setDepthTexture(depth.texture, BasicDepthPacking)
    const previousHandler = renderer.debug.onShaderError
    const previousCheck = renderer.debug.checkShaderErrors
    const target = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel()
    const viewport = renderer.getViewport(new Vector4()),
      scissor = renderer.getScissor(new Vector4())
    const scissorTest = renderer.getScissorTest()
    renderer.debug.checkShaderErrors = true
    renderer.debug.onShaderError = (gl, program, vertex, fragment): void => {
      previousHandler?.(gl, program, vertex, fragment)
      throw new Error(
        `Scene cloud shader compilation failed: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
      )
    }
    try {
      if (!this.initialized) {
        effect.initialize(renderer, false, HalfFloatType)
        this.initialized = true
      }
      // Exactly one public update owns both current/resolve draws and cloud shadows.
      effect.update(renderer, inputBuffer, frame.deltaSeconds)
      const overlay = effect.atmosphereOverlay?.map
      if (!overlay || overlay !== effect.cloudsPass.outputBuffer)
        throw new Error('Scene cloud update produced no resolved overlay')
      return {
        frame,
        atmosphereActorId: atmosphere.actorId,
        atmosphereGeneration: atmosphere.generation,
        atmosphereBottomRadiusMeters: atmosphere.config.bottomRadius * 1000,
        historyGeneration: this.historyGeneration,
        overlay,
        shadow: effect.atmosphereShadow,
        stbn: this.noise.noise
      }
    } finally {
      renderer.debug.onShaderError = previousHandler
      renderer.debug.checkShaderErrors = previousCheck
      renderer.setRenderTarget(target, face, mip)
      renderer.setViewport(viewport)
      renderer.setScissor(scissor)
      renderer.setScissorTest(scissorTest)
    }
  }

  public resetHistory(): void {
    if (this.disposed) throw new Error('Scene cloud backend is disposed')
    this.releaseEffect()
    this.historyGeneration++
    this.atmosphereGeneration = this.atmosphere.generation
    this.createEffect()
  }

  public setSize(width: number, height: number): void {
    if (this.disposed) throw new Error('Scene cloud backend is disposed')
    if (this.width === width && this.height === height) return
    this.width = width
    this.height = height
    this.effect.setSize(width, height)
  }

  private releaseEffect(): void {
    this.restoreTargets?.()
    this.patches?.dispose()
    this.appearance?.dispose()
    // Noise is backend-owned and survives a public effect recreation.
    this.effect.shapeTexture = null
    this.effect.shapeDetailTexture = null
    this.effect.localWeatherTexture = null
    this.effect.stbnTexture = null
    this.effect.transmittanceTexture = null
    this.effect.scatteringTexture = null
    this.effect.irradianceTexture = null
    this.effect.dispose()
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseEffect()
    this.noise.dispose()
  }
}
