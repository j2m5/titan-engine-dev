import { PostEffectStep } from '@/core/graphic/postprocessing/PostEffectStep'
import { Camera, HalfFloatType, Scene, WebGLRenderer } from 'three'
import { BloomEffectOptions, Effect, EffectComposer, EffectPass, RenderPass } from 'postprocessing'
import {
  ChromaticAberrationOptions,
  LensFlareEffectOptions,
  ToneMappingOptions,
  ZoomBlurEffectOptions
} from '@/core/graphic/postprocessing/types'
import { ScenePostProcessor } from '@/core/graphic/postprocessing/ScenePostProcessor'
import { BloomStep } from '@/core/graphic/postprocessing/BloomStep'
import { ToneMappingStep } from '@/core/graphic/postprocessing/ToneMappingStep'
import { SelectiveBloomStep } from '@/core/graphic/postprocessing/SelectiveBloomStep'
import { ChromaticAberrationStep } from '@/core/graphic/postprocessing/ChromaticAberrationStep'
import { ZoomBlurStep } from '@/core/graphic/postprocessing/ZoomBlurStep'
import { LensFlareStep } from '@/core/graphic/postprocessing/LensFlareStep'

class PostEffectBuilder {
  private steps: PostEffectStep[] = []
  private scene!: Scene
  private camera!: Camera
  private readonly renderer: WebGLRenderer

  public constructor(renderer: WebGLRenderer) {
    this.renderer = renderer
  }

  public start(scene: Scene, camera: Camera): PostEffectBuilder {
    this.scene = scene
    this.camera = camera

    return this
  }

  public addBloom(config: BloomEffectOptions): PostEffectBuilder {
    this.steps.push(new BloomStep(config))

    return this
  }

  public addSelectiveBloom(scene: Scene, camera: Camera, config: BloomEffectOptions): PostEffectBuilder {
    this.steps.push(new SelectiveBloomStep(scene, camera, config))

    return this
  }

  public addToneMapping(config: ToneMappingOptions): PostEffectBuilder {
    this.steps.push(new ToneMappingStep(config))

    return this
  }

  public addZoomBlur(config: ZoomBlurEffectOptions): PostEffectBuilder {
    this.steps.push(new ZoomBlurStep(config))

    return this
  }

  public addLensFlare(config: LensFlareEffectOptions): PostEffectBuilder {
    this.steps.push(new LensFlareStep(config))

    return this
  }

  public addChromaticAberration(config: ChromaticAberrationOptions): PostEffectBuilder {
    this.steps.push(new ChromaticAberrationStep(config))

    return this
  }

  public build(): ScenePostProcessor {
    const composer: EffectComposer = new EffectComposer(this.renderer, {
      depthBuffer: true,
      frameBufferType: HalfFloatType,
      multisampling: 4
    })

    composer.addPass(new RenderPass(this.scene, this.camera))
    composer.addPass(new EffectPass(this.camera, ...this.steps.map((step: PostEffectStep): Effect => step.apply())))

    return new ScenePostProcessor(composer)
  }
}

export { PostEffectBuilder }
