import { PostEffectStep } from '@/core/graphic/postprocessing/PostEffectStep'
import { ChromaticAberrationEffect, Effect } from 'postprocessing'
import { ChromaticAberrationOptions } from '@/core/graphic/postprocessing/types'

class ChromaticAberrationStep implements PostEffectStep {
  private readonly config: ChromaticAberrationOptions

  public constructor(config: ChromaticAberrationOptions) {
    this.config = config
  }

  public apply(): Effect {
    return new ChromaticAberrationEffect(this.config)
  }
}

export { ChromaticAberrationStep }
