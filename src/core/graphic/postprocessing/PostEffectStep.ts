import { Effect } from 'postprocessing'

interface PostEffectStep {
  apply(): Effect
}

export type { PostEffectStep }
