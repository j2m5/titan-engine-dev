import { PostEffectStep } from '@/core/graphic/postprocessing/PostEffectStep.ts'
import { ToneMappingOptions } from '@/core/graphic/postprocessing/types.ts'
import { Effect, ToneMappingEffect } from 'postprocessing'

class ToneMappingStep implements PostEffectStep {
  private readonly config: ToneMappingOptions

  public constructor(config: ToneMappingOptions) {
    this.config = config
  }

  public apply(): Effect {
    return new ToneMappingEffect(this.config)
  }
}

export { ToneMappingStep }
