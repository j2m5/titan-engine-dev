import type { Actor } from '@/core/models/Actor'
import { midbandParamsOf } from './midbandParams'
import { TALUS_DETAIL_PATHS } from './steepDetailPaths'

/** One decision for streaming and shading: the apron color and secondary normal use the same gravel. */
export function talusDetailFor(model: Actor): typeof TALUS_DETAIL_PATHS | null {
  const params = midbandParamsOf(model)
  return params.bedrockStrength > 0 && params.bedrockWeathering > 0 ? TALUS_DETAIL_PATHS : null
}
