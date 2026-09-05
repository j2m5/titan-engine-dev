/** CPU-зеркало формулы dist из WaterShaderTemplate (блок пены): та же арифметика, тот же пол градиента, то же смещение уреза. */
export const FOAM_GRAD_FLOOR = 1e-4
/**
 * Суша клампит канал A в 0 → билинейный скат начинается на полтекселя раньше
 * берега; на линейном шельфе оценка на самом урезе = texel/3 при любом уклоне.
 * Вычитание сажает кайму на урез (см. спеку §1.1).
 */
export const FOAM_SHORE_BIAS_TEXELS = 1 / 3

/**
 * texelMeters — экваториальный u-тексель и v-тексель раздельно (равнопрямоугольная
 * сетка: u сжимается на cos широты, v постоянен); cosLat=1 — экватор.
 */
export function foamDistanceMeters(
  sampleA: (u: number, v: number) => number,
  u: number,
  v: number,
  texelUv: { x: number; y: number },
  texelMeters: { x: number; y: number },
  cosLat: number = 1
): number {
  const a0 = sampleA(u, v)
  const aE = sampleA(u + texelUv.x, v)
  // юг = −v (terrainUv растёт на север)
  const aS = sampleA(u, v - texelUv.y)
  const tx = texelMeters.x * Math.max(cosLat, 0.05)
  const ty = texelMeters.y
  const gx = (aE - a0) / tx
  const gy = (aS - a0) / ty
  const gradLen = Math.max(Math.hypot(gx, gy), FOAM_GRAD_FLOOR / ty)
  const raw = a0 / gradLen
  const texelAlong = gradLen / Math.max(Math.hypot(gx / tx, gy / ty), 1e-12)

  return Math.max(raw - FOAM_SHORE_BIAS_TEXELS * texelAlong, 0)
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)

  return t * t * (3 - 2 * t)
}

export function shoreBand(dist: number, shoreMeters: number): number {
  return 1 - smoothstep(0, shoreMeters, dist)
}

/** Высота карты (тексели), фиксированная для v-шельфа теста «градиент на юг». */
const SOUTH_SHELF_HEIGHT_TEXELS = 32

/**
 * Канал A линейного шельфа: урез на середине оси, глубина растёт с уклоном
 * slope (м/м), квант 1/255 как в файле, билинейная выборка вдоль ОДНОЙ оси
 * (другая однородна). axis='u' — урез на u=0.5, глубина растёт на восток
 * (width текселей); axis='v' — урез на v=0.5, глубина растёт на юг (v
 * убывает, terrainUv растёт на север), высота карты фиксирована 32 текселя
 * (see SOUTH_SHELF_HEIGHT_TEXELS) — независимо от width.
 */
export function linearShelfSampler(
  slope: number,
  width: number,
  texelMeters: number,
  shallowRangeMeters: number = 200,
  axis: 'u' | 'v' = 'u'
) {
  const size = axis === 'u' ? width : SOUTH_SHELF_HEIGHT_TEXELS
  const texelA = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    const center = (i + 0.5) / size
    const dist = axis === 'u' ? (center - 0.5) * size * texelMeters : (0.5 - center) * size * texelMeters
    const depth = Math.max(0, dist * slope)
    texelA[i] = Math.round(Math.min(depth / shallowRangeMeters, 1) * 255) / 255
  }

  return (u: number, v: number): number => {
    const coord = axis === 'u' ? u : v
    const x = coord * size - 0.5
    const i0 = Math.floor(x)
    const f = x - i0
    const a = texelA[Math.min(Math.max(i0, 0), size - 1)]
    const b = texelA[Math.min(Math.max(i0 + 1, 0), size - 1)]

    return a * (1 - f) + b * f
  }
}
