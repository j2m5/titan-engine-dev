import { PostEffectBuilder } from '@/core/graphic/postprocessing/PostEffectBuilder'
import { ScenePostProcessor } from '@/core/graphic/postprocessing/ScenePostProcessor'
import { threeJS } from '@/core/graphic/ThreeJS'
import { BlendFunction, ToneMappingMode } from 'postprocessing'

class PostEffectPipeline {
  private builder: PostEffectBuilder

  public constructor(builder: PostEffectBuilder) {
    this.builder = builder
  }

  public collectForMainScene(): ScenePostProcessor {
    return this.builder
      .start(threeJS.scene, threeJS.camera)
      .addBloom({
        blendFunction: BlendFunction.SCREEN,
        mipmapBlur: true,
        luminanceThreshold: 1.4,
        luminanceSmoothing: 0.0025,
        intensity: 5
      })
      .addToneMapping({
        mode: ToneMappingMode.ACES_FILMIC,
        blendFunction: BlendFunction.SET
      })
      .build()
  }
}

export { PostEffectPipeline }
