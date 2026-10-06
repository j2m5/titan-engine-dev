import { Uniform, Vector3 } from 'three'
import { RING_MOONLETS_MAX, type RingGap } from '@/core/renderables/DetailedRingStreamingSystem/ringMoonlets'

/**
 * Щели лунок колец: альфа кольца × маска щели у каждого потребителя,
 * читающего текстуру кольца: меш и проход глубины — ringGapMaskAA(r, fwidth(r))
 * (экранное сглаживание), тень на планете — ringGapMask(r).
 * x — радиус орбиты, y — полуширина щели, z — мягкий край, в единицах
 * радиуса потребителя. CPU-зеркала — ringGapMask/ringGapMaskAA в ringMoonlets.ts.
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

  // То же с радиальным футпринтом пикселя fw = fwidth(r): край не уже пикселя,
  // глубина щели — доля её покрытия пикселем. Издали субпиксельная щель тает,
  // а не мерцает discard'ом; при fw <= z совпадает с ringGapMask
  float ringGapMaskAA(float r, float fw) {
    float mask = 1.0;
    for (int i = 0; i < ${RING_MOONLETS_MAX}; i++) {
      if (i >= uRingGapCount) break;
      vec3 g = uRingGaps[i];
      float e = max(g.z, fw);
      float depth = clamp(2.0 * g.y / max(fw, 1e-9), 0.0, 1.0);
      mask *= 1.0 - depth * (1.0 - smoothstep(g.y - e, g.y, abs(r - g.x)));
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
