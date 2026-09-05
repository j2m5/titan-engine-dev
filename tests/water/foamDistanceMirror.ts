/** CPU-зеркало формулы dist из WaterShaderTemplate (блок пены): та же арифметика, тот же пол градиента, то же смещение уреза. */
export const FOAM_GRAD_FLOOR = 1e-4
/**
 * Суша клампит канал A в 0 → билинейный скат начинается на полтекселя раньше
 * берега; на линейном шельфе оценка на самом урезе = texel/3 при любом уклоне.
 * Вычитание сажает кайму на урез (см. спеку §1.1).
 */
export const FOAM_SHORE_BIAS_TEXELS = 1 / 3

export function foamDistanceMeters(
  sampleA: (u: number, v: number) => number,
  u: number,
  v: number,
  texelUv: { x: number; y: number },
  texelMeters: number
): number {
  const a0 = sampleA(u, v)
  const aE = sampleA(u + texelUv.x, v)
  // юг = −v (terrainUv растёт на север)
  const aS = sampleA(u, v - texelUv.y)
  const gradLen = Math.hypot(aE - a0, aS - a0)
  const raw = (a0 * texelMeters) / Math.max(gradLen, FOAM_GRAD_FLOOR)

  return Math.max(raw - FOAM_SHORE_BIAS_TEXELS * texelMeters, 0)
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)

  return t * t * (3 - 2 * t)
}

export function shoreBand(dist: number, shoreMeters: number): number {
  return 1 - smoothstep(0, shoreMeters, dist)
}

/**
 * Канал A линейного шельфа: урез на u = 0.5, глубина растёт на восток с
 * уклоном slope (м/м), квант 1/255 как в файле, билинейная выборка по u
 * (v однороден). width — тексели карты, texelMeters — метры текселя.
 */
export function linearShelfSampler(slope: number, width: number, texelMeters: number, shallowRangeMeters: number = 200) {
  const texelA = new Float64Array(width)
  for (let i = 0; i < width; i++) {
    const centerU = (i + 0.5) / width
    const distEast = (centerU - 0.5) * width * texelMeters
    const depth = Math.max(0, distEast * slope)
    texelA[i] = Math.round(Math.min(depth / shallowRangeMeters, 1) * 255) / 255
  }

  return (u: number, _v: number): number => {
    const x = u * width - 0.5
    const i0 = Math.floor(x)
    const f = x - i0
    const a = texelA[Math.min(Math.max(i0, 0), width - 1)]
    const b = texelA[Math.min(Math.max(i0 + 1, 0), width - 1)]

    return a * (1 - f) + b * f
  }
}
