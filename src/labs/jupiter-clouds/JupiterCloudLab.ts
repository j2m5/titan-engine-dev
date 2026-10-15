import type { CloudsEffectChangeEvent, CloudsQualityPreset } from '@takram/three-clouds'
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import {
  Data3DTexture,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  Texture,
  Vector2,
  WebGLRenderer
} from 'three'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { applyCloudView, CloudFlight, type CloudView } from './CloudFlight'
import {
  createJupiterAtmosphere,
  createJupiterClouds,
  setJupiterCloudQuality,
  createCloudSurfaceView
} from './JupiterCloudAdapter'
import { createCloudTextures } from './cloudTextures'
import { PlanetAerialPerspectiveEffect, applyAnalyticPlanetDepth } from './planetDepth'
import { cloudOpacityAtAltitude, DEFAULT_CLOUD_DISTANCE, type CloudDistanceRange } from './cloudDistance'
import { ActorResource } from '@storage/database'
import { resolveCloudConfig } from '@/core/clouds/validateCloudConfig'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'
import { assertCloudAppearanceSupport, bindCloudAppearance, type CloudAppearanceBinding } from './cloudAppearance'
import {
  prepareCloudAppearanceTextures,
  type CloudAppearanceTextures,
  type CloudTextureResolver
} from './cloudAppearanceTextures'

export interface JupiterCloudLabOptions {
  resolveCloudTexture?: CloudTextureResolver
}

export interface CloudLabStats {
  altitudeKm: number
  frameMs: number
  frames: number
  cloudOpacity: number
  cloudFrames: number
  shadowFrames: number
  appearanceState: 'ready' | 'unavailable'
  appearanceMessage: string | null
}

/** Experimental renderer: Titan atmosphere data/LUTs, Takram cloud and atmosphere composition. */
export class JupiterCloudLab {
  private readonly renderer: WebGLRenderer
  private readonly camera = new PerspectiveCamera(55, 1, 10, 5e8)
  private readonly scene = new Scene()
  private readonly planetConfig = createJupiterAtmosphere()
  private readonly clouds = createJupiterClouds(this.camera, this.planetConfig.atmosphere)
  private readonly textures = createCloudTextures()
  private readonly profile = createJupiterCloudProfile()
  private appearanceTextures?: CloudAppearanceTextures
  private appearanceBinding?: CloudAppearanceBinding
  private surfaceView?: Texture
  private appearanceReady = false
  private appearanceMessage: string | null = null
  private readonly generator: AtmosphereLUTGenerator
  private readonly atmosphere: PlanetAerialPerspectiveEffect
  private readonly composer: EffectComposer
  private readonly flight: CloudFlight
  private readonly planet: Mesh<SphereGeometry, MeshBasicMaterial>
  private readonly resizeObserver: ResizeObserver
  private readonly size = new Vector2()
  private frameRequest = 0
  private previousTime = 0
  private elapsed = 0
  private frameMs = 0
  private frames = 0
  private disposed = false
  private cloudsEnabled = true
  private cloudOpacity = 0
  private cloudFrames = 0
  private shadowFrames = 0
  private resetShadowHistory = true
  private cloudDistance: CloudDistanceRange = { ...DEFAULT_CLOUD_DISTANCE }
  private quality: CloudsQualityPreset = 'medium'
  private readonly contextLost: (event: Event) => void
  private readonly cloudChange: (event: CloudsEffectChangeEvent) => void

  constructor(
    private readonly container: HTMLElement,
    private readonly onStats: (stats: CloudLabStats) => void,
    private readonly onError: (error: Error) => void,
    private readonly surfaceTexture: Texture,
    options: JupiterCloudLabOptions = {}
  ) {
    try {
      this.renderer = new WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true })
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      this.renderer.toneMapping = NoToneMapping
      this.renderer.toneMappingExposure = 3
      this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
        const detail = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join(
          '\n'
        )
        throw new Error(`Ошибка компиляции шейдера облаков: ${detail}`)
      }
      container.append(this.renderer.domElement)
      this.contextLost = (event): void => {
        event.preventDefault()
        this.dispose()
        this.onError(new Error('Графический контекст потерян. Перезагрузите сцену.'))
      }
      this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost)
      const radius = this.planetConfig.atmosphere.bottomRadius
      this.clouds.worldToECEFMatrix.makeTranslation(0, 0, radius)
      applyAnalyticPlanetDepth(this.clouds)
      this.clouds.shapeTexture = this.textures.shape
      this.clouds.shapeDetailTexture = this.textures.detail
      this.clouds.stbnTexture = this.textures.noise
      // Stationary weather first: fast flight tests should expose camera history independently.
      this.clouds.shapeVelocity.set(0, 0, 0)

      this.generator = new AtmosphereLUTGenerator(this.renderer)
      const lut = this.generator.generate(this.planetConfig.config)
      const textureProps = {
        transmittanceTexture: lut.transmittance,
        scatteringTexture: lut.scattering as Data3DTexture,
        irradianceTexture: lut.irradiance
      }
      Object.assign(this.clouds, textureProps)
      this.atmosphere = new PlanetAerialPerspectiveEffect(
        this.camera,
        {
          ...textureProps,
          ellipsoid: this.clouds.ellipsoid,
          correctAltitude: false,
          correctGeometricError: false,
          sky: true,
          sun: true,
          moon: false,
          sunLight: true,
          skyLight: true
        },
        this.planetConfig.atmosphere
      )
      this.atmosphere.worldToECEFMatrix.copy(this.clouds.worldToECEFMatrix)
      this.atmosphere.stbnTexture = this.textures.noise
      this.cloudChange = (): void => {
        // CloudsEffect.skipRendering stays true: the aerial pass composites the overlay exactly once.
        this.atmosphere.overlay = this.cloudOpacity > 0 ? this.clouds.atmosphereOverlay : null
        this.atmosphere.shadow = this.cloudOpacity > 0 ? this.clouds.atmosphereShadow : null
      }
      this.clouds.events.addEventListener('change', this.cloudChange)
      const updateClouds = this.clouds.update.bind(this.clouds)
      this.clouds.update = (renderer, input, delta): void => {
        if (this.cloudOpacity > 0) {
          const alpha = this.clouds.shadowPass.resolveMaterial.uniforms.temporalAlpha
          const previousAlpha = alpha.value
          if (this.resetShadowHistory) alpha.value = 1
          try {
            updateClouds(renderer, input, delta)
            this.resetShadowHistory = false
            this.cloudFrames++
          } finally {
            alpha.value = previousAlpha
          }
        }
      }

      const shadowPass = this.clouds.shadowPass.currentPass
      const renderShadow = shadowPass.render
      const countShadowFrame = (): void => {
        this.shadowFrames++
      }
      shadowPass.render = function (...args): ReturnType<typeof renderShadow> {
        const result = renderShadow.apply(this, args)
        countShadowFrame()
        return result
      }

      this.surfaceView = createCloudSurfaceView(surfaceTexture, this.profile.mapping.longitudeOffsetRadians)
      this.surfaceView.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
      this.planet = new Mesh(new SphereGeometry(radius, 512, 256), new MeshBasicMaterial({ map: this.surfaceView }))
      this.planet.position.z = -radius
      this.scene.add(this.planet)
      // Recoverable appearance preparation must leave the planet and atmosphere usable.
      try {
        const ids = new Set(ActorResource.filter((entry) => entry.actorId === 10).map((entry) => entry.resourceId))
        const result = resolveCloudConfig(this.profile, ids)
        if (result.state !== 'configured') throw new Error('Invalid Jupiter cloud profile')
        assertCloudAppearanceSupport(result.config)
        const textureById = new Map<number, Texture>([[32, surfaceTexture]])
        this.appearanceTextures = prepareCloudAppearanceTextures(
          result.config.layers[0],
          options.resolveCloudTexture ?? ((id) => textureById.get(id))
        )
        this.appearanceBinding = bindCloudAppearance(this.clouds, result.config, this.appearanceTextures)
        this.appearanceReady = true
      } catch (error) {
        this.appearanceBinding?.dispose()
        this.appearanceTextures?.dispose()
        this.appearanceBinding = undefined
        this.appearanceTextures = undefined
        this.appearanceMessage = `Объёмные облака недоступны: ${error instanceof Error ? error.message : String(error)}`
      }
      this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: 0 })
      this.composer.addPass(new RenderPass(this.scene, this.camera))
      // Keep the two depth consumers in one pass, as in Takram's vanilla example.
      // Two swapped depth passes with MSAA=0 would sample the depth texture attached to their output.
      this.composer.addPass(new EffectPass(this.camera, this.clouds, this.atmosphere))
      this.composer.addPass(new EffectPass(this.camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX })))
      this.flight = new CloudFlight(this.camera, this.renderer.domElement, radius)
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(container)
      this.resize()
      this.setSunAngle(35)
      this.setView('orbit')
      this.frameRequest = requestAnimationFrame(this.render)
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  private resize(): void {
    if (this.disposed) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.composer.setSize(width, height)
    this.clearHistory()
  }

  private clearHistory(): void {
    // Seed the next shadow resolve with current samples only; it also stores fresh matrices.
    this.resetShadowHistory = true
    // Same-size setSize does not invalidate Three render targets. Force reallocation on cuts,
    // then return to the actual size. Camera matrix history is also reset by CloudsPass.setSize.
    this.renderer.getDrawingBufferSize(this.size)
    this.clouds.setSize(this.size.x + 4, this.size.y + 4)
    this.clouds.setSize(this.size.x, this.size.y)
  }

  setView(view: CloudView): void {
    applyCloudView(this.camera, view, this.planetConfig.atmosphere.bottomRadius)
    this.clearHistory()
  }

  setQuality(quality: CloudsQualityPreset): void {
    this.quality = quality
    setJupiterCloudQuality(this.clouds, quality)
    this.clearHistory()
  }

  setCloudsEnabled(enabled: boolean): void {
    this.cloudsEnabled = enabled
  }

  setPlanetRotation(rotation: Quaternion): void {
    this.planet.quaternion.copy(rotation).normalize()
    this.appearanceBinding?.setPlanetRotation(this.planet.quaternion)
    this.clearHistory()
  }

  setCloudDistance(range: CloudDistanceRange): void {
    cloudOpacityAtAltitude(this.flight.altitude, range) // Validate before accepting UI values.
    this.cloudDistance = { ...range }
  }

  private updateCloudVisibility(): void {
    const volumeEnabled = this.cloudsEnabled && this.appearanceReady
    const opacity = volumeEnabled ? cloudOpacityAtAltitude(this.flight.altitude, this.cloudDistance) : 0
    const entering = this.cloudOpacity === 0 && opacity > 0
    this.cloudOpacity = opacity
    this.atmosphere.setCloudOpacity(opacity)
    if (entering) this.clearHistory()
    this.cloudChange({ type: 'change' })
  }

  setSunAngle(degrees: number): void {
    const angle = (degrees * Math.PI) / 180
    this.clouds.sunDirection.set(Math.sin(angle), 0, Math.cos(angle))
    this.atmosphere.sunDirection.copy(this.clouds.sunDirection)
    this.clearHistory()
  }

  private readonly render = (time: number): void => {
    if (this.disposed) return
    const delta = this.previousTime === 0 ? 1 / 60 : Math.min((time - this.previousTime) / 1000, 0.1)
    if (this.previousTime !== 0) this.frameMs += (time - this.previousTime - this.frameMs) * 0.08
    this.previousTime = time
    this.flight.update(delta)
    this.updateCloudVisibility()
    this.clouds.clouds.accurateSunSkyLight = this.quality === 'high' || this.flight.altitude > 1e6
    this.camera.updateMatrixWorld()
    try {
      this.composer.render(delta)
    } catch (error) {
      this.dispose()
      this.onError(error instanceof Error ? error : new Error(String(error)))
      return
    }
    this.frames++
    this.elapsed += delta
    if (this.elapsed > 0.2) {
      this.onStats({
        altitudeKm: this.flight.altitude / 1000,
        frameMs: this.frameMs,
        frames: this.frames,
        cloudOpacity: this.cloudOpacity,
        cloudFrames: this.cloudFrames,
        shadowFrames: this.shadowFrames,
        appearanceState: this.appearanceReady ? 'ready' : 'unavailable',
        appearanceMessage: this.appearanceMessage
      })
      this.elapsed = 0
    }
    this.frameRequest = requestAnimationFrame(this.render)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frameRequest)
    this.resizeObserver?.disconnect()
    this.flight?.dispose()
    if (this.cloudChange) this.clouds.events.removeEventListener('change', this.cloudChange)
    if (this.contextLost) this.renderer?.domElement.removeEventListener('webglcontextlost', this.contextLost)
    if (this.composer) this.composer.dispose()
    else {
      this.clouds.dispose()
      this.atmosphere?.dispose()
    }
    this.planet?.geometry.dispose()
    this.planet?.material.dispose()
    this.appearanceBinding?.dispose()
    this.appearanceTextures?.dispose()
    this.surfaceView?.dispose()
    this.textures.dispose()
    this.surfaceTexture.dispose()
    this.generator?.dispose()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.renderer?.domElement.remove()
  }
}
