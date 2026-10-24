import {
  HalfFloatType,
  NoToneMapping,
  SRGBColorSpace,
  type WebGLRenderer,
  type PerspectiveCamera,
  type Scene,
  type Mesh,
  type SphereGeometry,
  type ShaderMaterial,
  type WebGLRenderTarget
} from 'three'
import { EffectComposer, RenderPass, EffectPass, ShaderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import type { PlanetAerialPerspectiveEffect } from '@/labs/jupiter-clouds/planetDepth'
import type { EarthSurfacePair } from './EarthSurfaceMaterial'
import {
  runEarthFrame,
  type EarthFrameRequest,
  type EarthFrameResult,
  type EarthVolumeFrame
} from './earthFrameSchedule'
import { createEarthHdrBlendMaterial } from './earthHdrBlend'
export interface EarthCloudComposerOptions {
  renderer: WebGLRenderer
  camera: PerspectiveCamera
  scene: Scene
  planet: Mesh<SphereGeometry, ShaderMaterial>
  materials: EarthSurfacePair
  farAerial: PlanetAerialPerspectiveEffect
  nearAerial: PlanetAerialPerspectiveEffect
}
export class EarthCloudComposer {
  private readonly farComposer: EffectComposer
  private readonly nearComposer: EffectComposer
  private readonly finalComposer: EffectComposer
  private readonly blendMaterial: ShaderMaterial
  private disposed = false

  constructor(private readonly options: EarthCloudComposerOptions) {
    const { renderer, camera, scene, farAerial, nearAerial } = options
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = SRGBColorSpace
    for (const aerial of [farAerial, nearAerial]) {
      aerial.sunLight = false
      aerial.skyLight = false
      aerial.overlay = null
      aerial.shadow = null
      aerial.shadowLength = null
    }
    nearAerial.setCloudOpacity(1)
    const endpoint = (aerial: PlanetAerialPerspectiveEffect) => {
      const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 })
      composer.autoRenderToScreen = false
      composer.addPass(new RenderPass(scene, camera))
      composer.addPass(new EffectPass(camera, aerial))
      return composer
    }
    this.farComposer = endpoint(farAerial)
    this.nearComposer = endpoint(nearAerial)
    // Pinned RenderPass.needsSwap=false → aerial writes outputBuffer.
    // Composer.render swaps local pointers only. Changing this chain requires
    // updating these bindings and the composition GPU output/depth probes.
    this.blendMaterial = createEarthHdrBlendMaterial(
      this.farComposer.outputBuffer.texture,
      this.nearComposer.outputBuffer.texture
    )
    this.finalComposer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      depthBuffer: false,
      multisampling: 0
    })
    this.finalComposer.addPass(new ShaderPass(this.blendMaterial))
    this.finalComposer.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX })))
  }

  render(
    input: EarthFrameRequest & {
      deltaSeconds: number
      updateVolume(inputBuffer: WebGLRenderTarget, dt: number): EarthVolumeFrame
    }
  ): EarthFrameResult {
    if (this.disposed) throw new Error('Earth cloud composer is disposed')
    const { planet, materials, nearAerial } = this.options
    const previousMaterial = planet.material
    try {
      return runEarthFrame(input, {
        updateVolume: () => input.updateVolume(this.nearComposer.inputBuffer, input.deltaSeconds),
        renderNear: (frame) => {
          materials.bindShadow(frame.shadow)
          nearAerial.overlay = frame.overlay
          nearAerial.setCloudOpacity(1)
          planet.material = materials.near
          this.nearComposer.render(input.deltaSeconds)
        },
        renderFar: (showMap) => {
          materials.setMapEnabled(showMap)
          planet.material = materials.far
          this.farComposer.render(input.deltaSeconds)
        },
        clearVolume: () => {
          materials.bindShadow(null)
          nearAerial.overlay = null
        },
        present: (weight) => {
          this.blendMaterial.uniforms.weight.value = weight
          this.finalComposer.render(input.deltaSeconds)
        }
      })
    } finally {
      planet.material = previousMaterial
    }
  }

  setSize(widthCss: number, heightCss: number): void {
    for (const composer of [this.farComposer, this.nearComposer, this.finalComposer])
      composer.setSize(widthCss, heightCss, false)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // Composers own aerials, passes and targets; dispose together because
    // postprocessing shares fullscreen geometry across all composers.
    this.farComposer.dispose()
    this.nearComposer.dispose()
    this.finalComposer.dispose()
  }
}
