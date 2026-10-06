import { Uniform, Vector3 } from 'three'
import { RING_MOONLETS_MAX, type RingGap } from '@/core/renderables/DetailedRingStreamingSystem/ringMoonlets'

/**
 * Щели лунок колец: альфа кольца × ringGapMask(r) у каждого потребителя,
 * читающего текстуру кольца (меш, проход глубины, тень на планете).
 * x — радиус орбиты, y — полуширина щели, z — мягкий край, в единицах
 * радиуса потребителя. CPU-зеркало — ringGapMask в ringMoonlets.ts.
 */
export const ringGapUniforms = `
  uniform vec3 uRingGaps[${RING_MOONLETS_MAX}];
  uniform int uRingGapCount;
`

export const ringGapFunctions = `
  // 0 в середине щели, 1 снаружи, мягкий край шириной z; произведение по щелям
  float ringGapMask(float r) {
    float mask = 1.0;
    for (int i = 0; i < ${RING_MOONLETS_MAX}; i++) {
      if (i >= uRingGapCount) break;
      vec3 g = uRingGaps[i];
      mask *= smoothstep(g.y - g.z, g.y, abs(r - g.x));
    }
    return mask;
  }
`

/** Юниформы щелей: всегда RING_MOONLETS_MAX векторов (неиспользуемые — нули), счётчик — по данным. */
export function ringGapUniformValues(gaps: readonly RingGap[]): { uRingGaps: Uniform<Vector3[]>; uRingGapCount: Uniform<number> } {
  const vectors = Array.from({ length: RING_MOONLETS_MAX }, (_, i) =>
    i < gaps.length ? new Vector3(gaps[i].radius, gaps[i].halfWidth, gaps[i].edge) : new Vector3()
  )
  return { uRingGaps: new Uniform(vectors), uRingGapCount: new Uniform(Math.min(gaps.length, RING_MOONLETS_MAX)) }
}
