import { PostEffectStep } from '@/core/graphic/postprocessing/PostEffectStep'
import { Effect } from 'postprocessing'
import { ZoomBlurEffect } from '@/core/graphic/postprocessing/effects/ZoomBlurEffect'
import { ZoomBlurEffectOptions } from '@/core/graphic/postprocessing/types'

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
