import { PostEffectStep } from '@/core/graphic/postprocessing/PostEffectStep.ts'
import { BloomEffect, BloomEffectOptions, Effect } from 'postprocessing'

class BloomStep implements PostEffectStep {
  private readonly config: BloomEffectOptions

  public constructor(config: BloomEffectOptions) {
    this.config = config
  }

  public apply(): Effect {
    return new BloomEffect(this.config)
  }
}

export { BloomStep }
