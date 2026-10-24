import type { CloudsEffect } from '@takram/three-clouds'
import {
  Data3DTexture,
  HalfFloatType,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { ActorResource } from '@storage/database'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { resolveCloudConfig } from '@/core/clouds/validateCloudConfig'
import { cloudShellDistance, cloudVolumeOpacity } from '@/core/clouds/cloudLod'
import { CloudFlight, type CloudView } from '@/labs/jupiter-clouds/CloudFlight'
import { createCloudTextures } from '@/core/clouds/takram/cloudTextures'
import { applyAnalyticPlanetDepth, PlanetAerialPerspectiveEffect } from '@/labs/jupiter-clouds/planetDepth'
import { bindCloudAppearance, type CloudAppearanceBinding } from '@/core/clouds/appearance/cloudAppearance'
import type { CloudAppearanceTextures } from '@/core/clouds/appearance/cloudAppearanceTextures'
import {
  createEarthAtmosphere,
  createEarthClouds,
  prepareEarthCloudTargets,
  setEarthCloudQuality,
  type EarthCloudQuality
} from './EarthCloudAdapter'
import type { EarthTextures } from './earthAssets'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { bindEarthCloudLighting } from './earthCloudLighting'
import { createEarthSurfaceMaterials, type EarthSurfacePair } from './EarthSurfaceMaterial'
import { EarthCloudComposer } from './EarthCloudComposer'
import { EarthCloudState } from './earthCloudState'
import { applyEarthCloudView } from './earthCloudViews'

export interface EarthCloudLabOptions {
  autoStart?: boolean
  prepareCloudMaps?: (source: Texture) => CloudAppearanceTextures
}
export interface EarthCloudLabStats {
  altitudeKm: number
  frameMs: number
  frames: number
  volumeWeight: number
  cloudFrames: number
  shadowFrames: number
  farFrames: number
  nearFrames: number
  volumeState: 'prepared' | 'ready' | 'unavailable'
  volumeMessage: string | null
}

/** Owns all resources acquired during construction, including the passed source maps. */
export class EarthCloudLab {
  private renderer?: WebGLRenderer
  private readonly camera = new PerspectiveCamera(55, 1, 10, 5e8)
  private readonly scene = new Scene()
  private readonly state = new EarthCloudState()
  private readonly size = new Vector2()
  private readonly sunDirection = new Vector3()
  private readonly profile = createEarthCloudProfile()
  private radius = 6360000
  private clouds?: CloudsEffect
  private noise?: ReturnType<typeof createCloudTextures>
  private generator?: AtmosphereLUTGenerator
  private farAerial?: PlanetAerialPerspectiveEffect
  private nearAerial?: PlanetAerialPerspectiveEffect
  private materials?: EarthSurfacePair
  private geometry?: SphereGeometry
  private planet?: Mesh<SphereGeometry, EarthSurfacePair['far']>
  private appearance?: CloudAppearanceTextures
  private binding?: CloudAppearanceBinding
  private composer?: EarthCloudComposer
  private flight?: CloudFlight
  private observer?: ResizeObserver
  private readonly restorePasses: (() => void)[] = []
  private disposed = false
  private cloudsEnabled = true
  private frameRequest = 0
  private previousTime = 0
  private elapsed = 0
  private frameMs = 0
  private frames = 0
  private cloudFrames = 0
  private shadowFrames = 0
  private farFrames = 0
  private nearFrames = 0
  private volumeWeight = 0
  private dpr = 0

  constructor(
    private readonly container: HTMLElement,
    private readonly onStats: (stats: EarthCloudLabStats) => void,
    private readonly onError: (error: Error) => void,
    private readonly textures: EarthTextures,
    options: EarthCloudLabOptions = {}
  ) {
    try {
      const planetConfig = createEarthAtmosphere()
      this.radius = planetConfig.atmosphere.bottomRadius
      const renderer = (this.renderer = new WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true }))
      renderer.toneMapping = NoToneMapping
      renderer.toneMappingExposure = 1
      renderer.outputColorSpace = SRGBColorSpace
      renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
        throw new Error(
          `Earth cloud lab shader compilation failed: ${[gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n')}`
        )
      }
      container.append(renderer.domElement)
      renderer.domElement.addEventListener('webglcontextlost', this.contextLost)
      this.noise = createCloudTextures()
      this.generator = new AtmosphereLUTGenerator(renderer)
      const lut = this.generator.generate(planetConfig.config)
      const textureProps = {
        transmittanceTexture: lut.transmittance,
        scatteringTexture: lut.scattering as Data3DTexture,
        irradianceTexture: lut.irradiance
      }
      const aerialOptions = {
        ...textureProps,
        correctAltitude: false,
        correctGeometricError: false,
        sky: true,
        sun: true,
        moon: false,
        sunLight: false,
        skyLight: false,
        shadow: null,
        shadowLength: null
      }
      this.farAerial = new PlanetAerialPerspectiveEffect(this.camera, aerialOptions, planetConfig.atmosphere)
      this.nearAerial = new PlanetAerialPerspectiveEffect(this.camera, aerialOptions, planetConfig.atmosphere)
      for (const aerial of [this.farAerial, this.nearAerial]) {
        aerial.worldToECEFMatrix.makeTranslation(0, 0, this.radius)
        aerial.stbnTexture = this.noise.noise
      }
      this.materials = createEarthSurfaceMaterials({
        textures,
        radiusMeters: this.radius,
        atmosphere: planetConfig.config,
        lut: textureProps,
        stbnTexture: this.noise.noise,
        longitudeOffsetRadians: this.profile.mapping.longitudeOffsetRadians,
        shadowReferenceShader: this.nearAerial.getFragmentShader()
      })
      this.geometry = new SphereGeometry(this.radius, 512, 256)
      this.planet = new Mesh(this.geometry, this.materials.far)
      this.planet.position.z = -this.radius
      this.scene.add(this.planet)
      this.composer = new EarthCloudComposer({
        renderer,
        camera: this.camera,
        scene: this.scene,
        planet: this.planet,
        materials: this.materials,
        farAerial: this.farAerial,
        nearAerial: this.nearAerial
      })
      if (this.materials.volumeError) this.state.fail(this.materials.volumeError)
      else {
        try {
          // Actor 7 owns Earth maps; atmosphere reference 47 supplies the physical profile.
          const ids = new Set(ActorResource.filter((entry) => entry.actorId === 7).map((entry) => entry.resourceId))
          const resolved = resolveCloudConfig(this.profile, ids)
          if (resolved.state !== 'configured') throw new Error('Invalid Earth cloud profile')
          this.clouds = createEarthClouds(this.camera, planetConfig.atmosphere)
          this.clouds.worldToECEFMatrix.copy(this.farAerial.worldToECEFMatrix)
          applyAnalyticPlanetDepth(this.clouds)
          Object.assign(this.clouds, textureProps)
          this.clouds.shapeTexture = this.noise.shape
          this.clouds.shapeDetailTexture = this.noise.detail
          this.clouds.stbnTexture = this.noise.noise
          const prepared = prepareCloudSource(resolved.config, () => textures.clouds)
          this.appearance = prepared.textures
          if (options.prepareCloudMaps) {
            prepared.dispose()
            this.appearance = options.prepareCloudMaps(textures.clouds)
          }
          this.binding = bindCloudAppearance(this.clouds, prepared.config, this.appearance)
          this.restorePasses.push(bindEarthCloudLighting(this.clouds, this.radius))
          this.clouds.shapeVelocity.set(0, 0, 0)
          setEarthCloudQuality(this.clouds, 'medium')
          this.clouds.skipRendering = true
          this.clouds.initialize(renderer, false, HalfFloatType)
          this.restorePasses.push(prepareEarthCloudTargets(this.clouds))
          // Count successful underlying draws, including multi-pass implementations.
          this.countPass(this.clouds.cloudsPass.currentPass, () => this.cloudFrames++)
          this.countPass(this.clouds.shadowPass.currentPass, () => this.shadowFrames++)
          renderer.getDrawingBufferSize(this.size)
          this.clouds.setSize(this.size.x, this.size.y)
        } catch (error) {
          this.releaseVolume()
          this.state.fail(error instanceof Error ? error : new Error(String(error)))
        }
      }
      this.flight = new CloudFlight(this.camera, renderer.domElement, this.radius, {
        minAltitude: 100,
        maxAltitude: 40000000,
        minSpeed: 50,
        speedScale: 0.3,
        label: 'Полёт над Землёй: перетаскивание мышью, WASD и Q/E'
      })
      this.observer = new ResizeObserver(() => this.resize())
      this.observer.observe(container)
      this.resize()
      this.setSunAngle(35)
      // A measured cloud edge (about 15°S) shows volume structure in the demo.
      // This rotates the planet and its binding together; map coordinates stay canonical.
      const phi = 0.08203125 * Math.PI * 2,
        theta = (1 - 0.4140625) * Math.PI
      this.setPlanetRotation(
        new Quaternion().setFromUnitVectors(
          new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)),
          new Vector3(0, 0, 1)
        )
      )
      this.setView('orbit')
      if (options.autoStart !== false) this.frameRequest = requestAnimationFrame(this.render)
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  private countPass<T extends { render: (...args: never[]) => unknown }>(pass: T, count: () => void): void {
    const original = pass.render
    pass.render = function (...args: never[]) {
      const result = original.apply(this, args)
      count()
      return result
    }
    this.restorePasses.push(() => {
      pass.render = original
    })
  }

  private readonly contextLost = (event: Event): void => {
    event.preventDefault()
    this.dispose()
    this.onError(new Error('Графический контекст потерян. Перезагрузите сцену.'))
  }
  setView(view: CloudView): void {
    if (this.disposed) return
    applyEarthCloudView(this.camera, view, this.radius)
    this.state.invalidate()
  }
  setQuality(quality: EarthCloudQuality): void {
    if (this.disposed) return
    if (this.clouds) setEarthCloudQuality(this.clouds, quality)
    this.state.invalidate()
  }
  setCloudsEnabled(enabled: boolean): void {
    if (this.disposed) return
    if (enabled && !this.cloudsEnabled) this.state.invalidate()
    this.cloudsEnabled = enabled
    if (!enabled) this.clearVolume()
  }
  setSunAngle(degrees: number): void {
    if (this.disposed) return
    const angle = (degrees * Math.PI) / 180
    this.sunDirection.set(Math.sin(angle), 0, Math.cos(angle))
    this.clouds?.sunDirection.copy(this.sunDirection)
    this.farAerial?.sunDirection.copy(this.sunDirection)
    this.nearAerial?.sunDirection.copy(this.sunDirection)
    this.state.invalidate()
  }
  setPlanetRotation(rotation: Quaternion): void {
    if (this.disposed) return
    this.planet!.quaternion.copy(rotation).normalize()
    this.binding?.setPlanetRotation(this.planet!.quaternion)
    this.state.invalidate()
  }
  resize(): void {
    if (this.disposed || !this.renderer) return
    const width = Math.max(1, this.container.clientWidth),
      height = Math.max(1, this.container.clientHeight)
    this.dpr = Math.min(window.devicePixelRatio, 1.5)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.composer?.setSize(width, height)
    this.renderer.getDrawingBufferSize(this.size)
    this.clouds?.setSize(this.size.x, this.size.y)
    this.state.invalidate()
  }
  private clearVolume(): void {
    if (this.nearAerial) {
      this.nearAerial.overlay = null
      this.nearAerial.shadow = null
    }
    this.materials?.bindShadow(null)
  }
  renderFrame(deltaSeconds: number): void {
    if (this.disposed) return
    try {
      if (this.dpr !== Math.min(window.devicePixelRatio, 1.5)) this.resize()
      this.flight!.update(deltaSeconds)
      this.camera.updateMatrixWorld()
      this.planet!.updateMatrixWorld()
      this.binding?.setPlanetRotation(this.planet!.quaternion)
      const renderer = this.renderer!
      renderer.getDrawingBufferSize(this.size)
      this.materials!.updateFrame({
        camera: this.camera,
        planetMatrixWorld: this.planet!.matrixWorld,
        worldToECEFMatrix: this.farAerial!.worldToECEFMatrix,
        sunDirection: this.sunDirection,
        resolution: this.size,
        frame: this.frames
      })
      const requestedWeight = cloudVolumeOpacity(
        cloudShellDistance(this.flight!.altitude, this.profile.layers),
        this.profile.lod
      )
      const request = this.state.begin(requestedWeight, this.cloudsEnabled)
      if (request.resetHistory && this.clouds) {
        this.clouds.setSize(this.size.x + 4, this.size.y + 4)
        this.clouds.setSize(this.size.x, this.size.y)
      }
      const result = this.composer!.render({
        ...request,
        deltaSeconds,
        updateVolume: (input, dt) => {
          const clouds = this.clouds!
          const alpha = clouds.shadowPass.resolveMaterial.uniforms.temporalAlpha
          const previous = alpha.value
          if (request.resetHistory) alpha.value = 1
          try {
            clouds.update(renderer, input, dt)
            const overlay = clouds.atmosphereOverlay
            if (overlay === null) throw new Error('Cloud update produced no overlay')
            return { overlay, shadow: clouds.atmosphereShadow }
          } finally {
            alpha.value = previous
          }
        }
      })
      this.state.complete(result)
      this.volumeWeight = result.effectiveWeight
      if (result.volumeError) this.clearVolume()
      if (result.farRendered) this.farFrames++
      if (result.nearRendered) this.nearFrames++
      this.frames++
      this.elapsed += deltaSeconds
      if (this.elapsed >= 0.2) {
        this.elapsed = 0
        this.onStats(this.getStats())
      }
    } catch (error) {
      this.dispose()
      this.onError(error instanceof Error ? error : new Error(String(error)))
    }
  }
  getStats(): EarthCloudLabStats {
    const { volumeState, volumeMessage } = this.state.snapshot()
    return {
      altitudeKm: (this.flight?.altitude ?? this.camera.position.z) / 1000,
      frameMs: this.frameMs,
      frames: this.frames,
      volumeWeight: this.volumeWeight,
      cloudFrames: this.cloudFrames,
      shadowFrames: this.shadowFrames,
      farFrames: this.farFrames,
      nearFrames: this.nearFrames,
      volumeState,
      volumeMessage
    }
  }
  private readonly render = (time: number): void => {
    if (this.disposed) return
    const interval = this.previousTime ? time - this.previousTime : 1000 / 60
    this.frameMs = interval
    this.previousTime = time
    this.renderFrame(Math.min(interval / 1000, 0.1))
    if (!this.disposed) this.frameRequest = requestAnimationFrame(this.render)
  }
  private releaseVolume(): void {
    this.restorePasses
      .splice(0)
      .reverse()
      .forEach((restore) => restore())
    // Restore borrowed material mutations before destroying those materials.
    this.binding?.dispose()
    this.binding = undefined
    this.clouds?.dispose()
    this.clouds = undefined
    this.appearance?.dispose()
    this.appearance = undefined
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frameRequest)
    this.observer?.disconnect()
    this.renderer?.domElement.removeEventListener('webglcontextlost', this.contextLost)
    this.flight?.dispose()
    if (this.composer) this.composer.dispose()
    else {
      this.farAerial?.dispose()
      this.nearAerial?.dispose()
    }
    this.releaseVolume()
    this.geometry?.dispose()
    this.materials?.dispose()
    this.noise?.dispose()
    this.textures.dispose()
    this.generator?.dispose()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.renderer?.domElement.remove()
  }
}
