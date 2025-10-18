import { PostEffectStep } from '@/core/graphic/postprocessing/PostEffectStep.ts'
import { Effect } from 'postprocessing'
import { ZoomBlurEffect } from '@/core/graphic/postprocessing/effects/ZoomBlurEffect.ts'
import { ZoomBlurEffectOptions } from '@/core/graphic/postprocessing/types.ts'

class ZoomBlurStep implements PostEffectStep {
  private readonly config: ZoomBlurEffectOptions

  public constructor(config: ZoomBlurEffectOptions) {
    this.config = config
  }

  public apply(): Effect {
    return new ZoomBlurEffect(this.config)
  }
}

export { ZoomBlurStep }
