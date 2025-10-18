import { PostEffectStep } from '@/core/graphic/postprocessing/PostEffectStep'
import { LensFlareEffect } from '@/core/graphic/postprocessing/effects/LensFlareEffect'
import { LensFlareEffectOptions } from '@/core/graphic/postprocessing/types'
import { Effect } from 'postprocessing'

class LensFlareStep implements PostEffectStep {
  private readonly config: LensFlareEffectOptions

  public constructor(config: LensFlareEffectOptions) {
    this.config = config
  }

  public apply(): Effect {
    return new LensFlareEffect(this.config)
  }
}

export { LensFlareStep }
