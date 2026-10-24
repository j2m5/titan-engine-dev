import type { AtmosphereShadow } from '@takram/three-atmosphere'
import type { CloudsEffect } from '@takram/three-clouds'
import {
  BasicDepthPacking,
  Camera,
  Data3DTexture,
  HalfFloatType,
  Mesh,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
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
import { CloudProgramWarmup } from './CloudProgramWarmup'
import { setCloudQuality } from './cloudQuality'
import { prepareCloudTargets } from './prepareCloudTargets'
import { prepareCloudCurrentOutput } from './prepareCloudCurrentOutput'
import { prepareCloudShadowOutput } from './prepareCloudShadowOutput'
import { adaptSceneCloudShadowNumerics } from './sceneCloudShadowNumerics'
import { installSceneCloudPatches, type SceneCloudPatchBinding } from './sceneCloudLighting'
import {
  appendProgramCacheKey,
  captureShaderCompilation
} from '@/core/graphic/effects/atmosphere/shaderCompilationScope'

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
  private static programEpoch = 0
  private readonly counts = { cloudUpdates: 0, shadowUpdates: 0 }
  /** Logical attempts entering the one public update, not completed GPU draw counts. */
  public get updateCounts(): Readonly<{ cloudUpdates: number; shadowUpdates: number }> {
    return this.counts
  }
  public get shadowCascadeCount(): number {
    return this.effect.shadow.cascadeCount
  }
  private effect!: CloudsEffect
  private noise: ReturnType<typeof createCloudTextures>
  private appearance!: CloudAppearanceBinding
  private patches!: SceneCloudPatchBinding
  private restoreTargets!: () => void
  private packedOutput?: ReturnType<typeof prepareCloudCurrentOutput>
  private shadowOutput?: ReturnType<typeof prepareCloudShadowOutput>
  private initialized = false
  private readonly warmup = new CloudProgramWarmup()
  private warmupStarted = false
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
    this.noise = createCloudTextures(this.programCacheSuffix())
    try {
      this.createEffect()
    } catch (error) {
      this.noise.dispose()
      throw error
    }
  }

  private createEffect(): void {
    this.warmup.clear()
    this.warmupStarted = false
    const effect = createPlanetCloudEffect(this.frame.camera, toTakramAtmosphere(this.atmosphere.config))
    this.effect = effect
    for (const material of [
      effect.cloudsPass.currentMaterial,
      effect.cloudsPass.resolveMaterial,
      effect.shadowPass.currentMaterial,
      effect.shadowPass.resolveMaterial
    ])
      appendProgramCacheKey(material, this.programCacheSuffix())
    try {
      const config = structuredClone(this.prepared.config)
      config.layers[0].baseAltitudeMeters = cloudLayerAltitude(
        this.frame.datumRadiusMeters,
        this.atmosphere.config.bottomRadius * 1000,
        config.layers[0].baseAltitudeMeters
      )
      this.appearance = bindCloudAppearance(effect, config, this.prepared.textures)
      this.patches = installSceneCloudPatches(
        effect,
        this.profile === 'terrestrial' && this.frame.sceneLight !== undefined
      )
      this.restoreTargets = prepareCloudTargets(effect)
      setCloudQuality(effect, this.profile, this.quality)
      if (this.quality === 'high') {
        const shadow = effect.shadowPass.currentMaterial
        shadow.fragmentShader = adaptSceneCloudShadowNumerics(shadow.fragmentShader)
        shadow.needsUpdate = true
      }
      effect.haze = false
      effect.lightShafts = false
      this.packedOutput = prepareCloudCurrentOutput(effect.cloudsPass.currentPass, this.programCacheSuffix())
      this.shadowOutput = prepareCloudShadowOutput(effect.shadowPass, this.programCacheSuffix())
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

  /** Compile the exact first-draw variants while the live scene keeps its far endpoint. */
  public prepare(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): boolean {
    if (this.disposed) throw new Error('Scene cloud backend is disposed')
    if (!renderer.extensions.has('KHR_parallel_shader_compile')) return true
    if (!this.warmupStarted) {
      const effect = this.effect,
        camera = new Camera(),
        scene = new Scene(),
        geometry = new PlaneGeometry(2, 2)
      const target = renderer.getRenderTarget(),
        face = renderer.getActiveCubeFace(),
        mip = renderer.getActiveMipmapLevel()
      const viewport = renderer.getViewport(new Vector4()),
        scissor = renderer.getScissor(new Vector4()),
        test = renderer.getScissorTest()
      try {
        if (!this.initialized) {
          effect.initialize(renderer, false, HalfFloatType)
          this.initialized = true
        }
        const { mapSize, cascadeCount } = effect.shadow
        effect.shadowPass.setSize(mapSize.x, mapSize.y, cascadeCount)
        effect.cloudsPass.setShadowSize(mapSize.x, mapSize.y, cascadeCount)
        effect.cloudsPass.currentMaterial.copyCameraSettings(this.frame.camera)
        effect.cloudsPass.currentMaterial.depthPacking = BasicDepthPacking
        effect.cloudsPass.currentMaterial.localWeatherChannels = effect.cloudLayers.localWeatherChannels
        effect.shadowPass.currentMaterial.localWeatherChannels = effect.cloudLayers.localWeatherChannels
        renderer.setRenderTarget(inputBuffer)
        for (const material of [
          effect.cloudsPass.currentMaterial,
          effect.cloudsPass.resolveMaterial,
          effect.shadowPass.currentMaterial,
          effect.shadowPass.resolveMaterial
        ]) {
          const mesh = new Mesh(geometry, material)
          // Pinned CloudsMaterial chooses logarithmic depth and powder defines here.
          material.onBeforeRender(renderer, scene, camera, geometry, mesh, null as never)
          scene.add(mesh)
        }
        for (const mesh of this.noise.warmupMeshes) this.warmup.compile(renderer, mesh, camera)
        this.warmup.compile(renderer, this.packedOutput!.warmupScene, camera)
        this.warmup.compile(renderer, this.shadowOutput!.warmupScene, camera)
        this.warmup.compile(renderer, scene, camera)
        this.warmupStarted = true
      } finally {
        geometry.dispose()
        renderer.setRenderTarget(target, face, mip)
        renderer.setViewport(viewport)
        renderer.setScissor(scissor)
        renderer.setScissorTest(test)
      }
    }
    return this.warmup.ready()
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
    const compilation = captureShaderCompilation(renderer, 'Scene cloud')
    const target = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel()
    const viewport = renderer.getViewport(new Vector4()),
      scissor = renderer.getScissor(new Vector4())
    const scissorTest = renderer.getScissorTest()
    try {
      if (!this.initialized) {
        effect.initialize(renderer, false, HalfFloatType)
        this.initialized = true
      }
      // Exactly one public update owns both current/resolve draws and cloud shadows.
      this.counts.cloudUpdates++
      this.counts.shadowUpdates++
      effect.update(renderer, inputBuffer, frame.deltaSeconds)
      compilation.check()
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
        shadow: this.prepared.config.layers[0].castsShadow ? effect.atmosphereShadow : null,
        stbn: this.noise.noise
      }
    } catch (error) {
      // Failed programs may be cached with foreign references. Retire every owned material
      // and give only subsequent attempts a new public cache-key epoch.
      if (compilation.failed) SceneCloudBackend.programEpoch++
      this.releaseEffect()
      if (compilation.failed) {
        this.noise.dispose()
        this.noise = createCloudTextures(this.programCacheSuffix())
      }
      this.historyGeneration++
      this.createEffect()
      throw error
    } finally {
      compilation.restore()
      renderer.setRenderTarget(target, face, mip)
      renderer.setViewport(viewport)
      renderer.setScissor(scissor)
      renderer.setScissorTest(scissorTest)
    }
  }

  private programCacheSuffix(): string | undefined {
    return SceneCloudBackend.programEpoch ? `scene-cloud-retry-${SceneCloudBackend.programEpoch}` : undefined
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
    this.warmup.clear()
    this.packedOutput?.dispose()
    this.packedOutput = undefined
    this.shadowOutput?.dispose()
    this.shadowOutput = undefined
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
