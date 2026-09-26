import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUN_ANGULAR_RADIUS,
  TERRAIN_SHADOW_BIAS_SLOPE,
  TERRAIN_SHADOW_PENUMBRA_FLOOR,
  TERRAIN_SHADOW_STEPS,
  penumbraTan,
  terrainShadowMarch,
  terrainShadowUv,
  type HeightSampler,
  type Vec3
} from '@/core/materials/shaders/lib/chunks/terrainShadowMath'

// Конвенция карты (TerrainHeightField.dirToUv): x = −cos φ·sin θ, y = cos θ, z = sin φ·sin θ;
// u = φ/2π, v = θ/π (0 — север). На экваторе east = ∂dir/∂φ = (sin φ, 0, cos φ).
function dirAt(u: number, v: number): Vec3 {
  const phi = u * 2 * Math.PI, theta = v * Math.PI
  return [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)]
}
function eastAt(u: number): Vec3 {
  const phi = u * 2 * Math.PI
  return [Math.sin(phi), 0, Math.cos(phi)]
}
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}
/** Солнце над горизонтом на elev рад, вдоль −east (в сторону убывающего u). */
function sunTowardWest(u: number, elev: number): Vec3 {
  const up = dirAt(u, 0.5), e = eastAt(u)
  return norm([-Math.cos(elev) * e[0] + Math.sin(elev) * up[0], -Math.cos(elev) * e[1] + Math.sin(elev) * up[1], -Math.cos(elev) * e[2] + Math.sin(elev) * up[2]])
}

const R = 1e6
const H = 5000
const ELEV = (10 * Math.PI) / 180
const L = H / Math.tan(ELEV) // длина тени уступа на плоскости ≈ 28356
const params = { radius: R, texelAngle: (2 * Math.PI) / 4096, maxDist: 200000, penumbraTan: 0.0093 }
const arcU = (units: number): number => units / (2 * Math.PI * R) // дуга в долях u на экваторе

describe('terrainShadowUv', () => {
  it('север → v = 0, экватор → v = 0.5, u = φ/2π', () => {
    expect(terrainShadowUv([0, 1, 0])[1]).toBeCloseTo(0, 12)
    const uv = terrainShadowUv(dirAt(0.3, 0.5))
    expect(uv[0]).toBeCloseTo(0.3, 12)
    expect(uv[1]).toBeCloseTo(0.5, 12)
  })
})

describe('terrainShadowMarch: уступ высотой H', () => {
  // плато при u < 0.25, обрыв на u = 0.25, точка восточнее обрыва, солнце с запада (над плато)
  const cliff: HeightSampler = (uv) => (uv[0] < 0.25 ? H : 0)

  it('точка на 0.5·L от обрыва — в тени; на 2·L — освещена', () => {
    const near = 0.25 + arcU(0.5 * L), far = 0.25 + arcU(2 * L)
    expect(terrainShadowMarch(cliff, dirAt(near, 0.5), sunTowardWest(near, ELEV), params)).toBe(0)
    expect(terrainShadowMarch(cliff, dirAt(far, 0.5), sunTowardWest(far, ELEV), params)).toBe(1)
  })

  it('плоская карта — везде 1, ложной тени нет', () => {
    const flat: HeightSampler = () => 1000
    for (const u of [0.1, 0.5, 0.9]) {
      expect(terrainShadowMarch(flat, dirAt(u, 0.5), sunTowardWest(u, ELEV), params)).toBe(1)
      expect(terrainShadowMarch(flat, dirAt(u, 0.5), sunTowardWest(u, 0.001), params)).toBe(1)
    }
  })

  // Ламберт суши за терминатором не гасится (landGate ≡ 1), склон к солнцу даёт N·L > 0:
  // ночь для таких склонов гасит только марш
  it('солнце под горизонтом на ровной карте — тень самого тела', () => {
    const flat: HeightSampler = () => 1000
    for (const u of [0.1, 0.5, 0.9]) {
      expect(terrainShadowMarch(flat, dirAt(u, 0.5), sunTowardWest(u, -0.1), params)).toBe(0)
    }
  })

  it('вершина над окружением ловит солнце за геометрическим терминатором', () => {
    // провал горизонта с высоты H: √(2H/R) = 0.1 рад — солнце на −0.02 ещё видно
    const u0 = 0.3
    const peak: HeightSampler = (uv) => (Math.abs(uv[0] - u0) < arcU(500) ? H : 0)
    expect(terrainShadowMarch(peak, dirAt(u0, 0.5), sunTowardWest(u0, -0.02), params)).toBe(1)
  })

  it('шов долготы: плато за u = 0 даёт ту же тень, что без шва', () => {
    const d = arcU(0.5 * L)
    // плато за швом: u > 0.999; точка восточнее обрыва ЧЕРЕЗ шов, u ≈ 0.0013
    const seamCliff: HeightSampler = (uv) => (uv[0] > 0.999 ? H : 0)
    const plainCliff: HeightSampler = (uv) => (uv[0] < 0.499 ? H : 0)
    const seamU = 0.999 + d - 1
    const plainU = 0.499 + d
    const atSeam = terrainShadowMarch(seamCliff, dirAt(seamU, 0.5), sunTowardWest(seamU, ELEV), params)
    const plain = terrainShadowMarch(plainCliff, dirAt(plainU, 0.5), sunTowardWest(plainU, ELEV), params)
    expect(atSeam).toBe(0)
    expect(atSeam).toBeCloseTo(plain, 12)
  })

  it('полюс: плато-шапка севернее v = 0.001 затеняет точку южнее при солнце с севера', () => {
    const cap: HeightSampler = (uv) => (uv[1] < 0.001 ? H : 0)
    const v = 0.001 + (0.5 * L) / (Math.PI * R)
    const dir = dirAt(0.3, v)
    // север в точке — касательная проекция оси y: y − (y·dir)·dir
    const north = norm([-dir[1] * dir[0], 1 - dir[1] * dir[1], -dir[1] * dir[2]])
    // солнце на ELEV над горизонтом в сторону севера
    const sun = norm([Math.cos(ELEV) * north[0] + Math.sin(ELEV) * dir[0], Math.cos(ELEV) * north[1] + Math.sin(ELEV) * dir[1], Math.cos(ELEV) * north[2] + Math.sin(ELEV) * dir[2]])
    expect(terrainShadowMarch(cap, dir, sun, params)).toBe(0)
  })

  it('bias: подъём рельефа меньше bias тени не даёт (защита от ряби на низкой карте)', () => {
    const u0 = 0.3
    const bias = R * params.texelAngle * TERRAIN_SHADOW_BIAS_SLOPE
    const origin = terrainShadowUv(dirAt(u0, 0.5))
    const rippled: HeightSampler = (uv) => (Math.abs(uv[0] - origin[0]) < 1e-9 && Math.abs(uv[1] - origin[1]) < 1e-9 ? 0 : 0.5 * bias)
    expect(terrainShadowMarch(rippled, dirAt(u0, 0.5), sunTowardWest(u0, 1e-4), params)).toBe(1)
    // без bias тот же стенд был бы в тени: (0.5·bias − ≈4.7) / (sMin·0.0093) > 1
  })

  it('склон к солнцу положе луча — освещён на всей дистанции; константы', () => {
    // подъём к западу с уклоном 0.025, солнце на atan(0.04): луч уходит от рельефа, тени нет
    const gentle: HeightSampler = (uv) => (0.5 - uv[0]) * 2 * Math.PI * R * 0.025
    expect(terrainShadowMarch(gentle, dirAt(0.3, 0.5), sunTowardWest(0.3, Math.atan(0.04)), params)).toBe(1)
    expect(TERRAIN_SHADOW_STEPS).toBe(20)
    expect(TERRAIN_SHADOW_BIAS_SLOPE).toBe(0.05)
  })
})

describe('penumbraTan', () => {
  it('атмосфера: tan(sunAngularRadius)·softness; без атмосферы: R★/dist; пол 0.005; softness множит', () => {
    expect(penumbraTan(0.05, undefined, 1, 1)).toBeCloseTo(Math.tan(0.05), 12)
    expect(penumbraTan(undefined, 2, 100, 1)).toBeCloseTo(0.02, 12)
    expect(penumbraTan(undefined, 2, 100, 2)).toBeCloseTo(0.04, 12)
    expect(penumbraTan(0.001, undefined, 1, 1)).toBe(TERRAIN_SHADOW_PENUMBRA_FLOOR)
    expect(penumbraTan(undefined, undefined, 1, 1)).toBeCloseTo(Math.tan(0.0093), 12)
    expect(penumbraTan(0.05, 2, 100, 1)).toBeCloseTo(Math.tan(0.05), 12) // атмосфера в приоритете
  })
})

// Тело без атмосферы под звездой-гигантом: R★ = 1.06·10⁹ км с 32 а.е.
// (геометрия Emberon у W26). Полутень выходит в ≈24 раза шире земного
// фолбэка — ниже закреплены СООТНОШЕНИЯ марша при такой ширине, не облик.
describe('широкая полутень: звезда-гигант с орбиты в 32 а.е.', () => {
  const AU_KM = 149597870
  const STAR_RADIUS_KM = 1.06e9
  const DISTANCE_KM = 32 * AU_KM
  /** Без атмосферы penumbraTan возвращает САМО отношение R★/d, а не atan от него. */
  const WIDE = penumbraTan(undefined, STAR_RADIUS_KM, DISTANCE_KM, 1)
  const NARROW = penumbraTan(undefined, undefined, 1, 1)

  const RADIUS = 5200e3 // м
  const wideParams = { radius: RADIUS, texelAngle: (2 * Math.PI) / 8192, maxDist: 400000, penumbraTan: WIDE }
  const narrowParams = { ...wideParams, penumbraTan: NARROW }
  const arc = (units: number): number => units / (2 * Math.PI * RADIUS)

  it('полутень = R★/d ≈ 0.2214: не фолбэк Солнца и не упёрлась в пол', () => {
    expect(WIDE).toBeCloseTo(STAR_RADIUS_KM / DISTANCE_KM, 12)
    expect(WIDE).toBeCloseTo(0.2214, 4)
    expect(WIDE).not.toBeCloseTo(Math.tan(DEFAULT_SUN_ANGULAR_RADIUS), 6)
    expect(WIDE).toBeGreaterThan(TERRAIN_SHADOW_PENUMBRA_FLOOR)
    expect(WIDE / NARROW).toBeGreaterThan(20)
  })

  it('плоская земля при солнце 3° освещена ровно на 1 — «всё в полутени» не наступает', () => {
    const flat: HeightSampler = () => 1000
    const elev = (3 * Math.PI) / 180

    for (const u of [0.1, 0.5, 0.9]) {
      expect(terrainShadowMarch(flat, dirAt(u, 0.5), sunTowardWest(u, elev), wideParams)).toBe(1)
    }
  })

  // Уступ 20 км, солнце 10° над горизонтом: длина тени на плоскости ≈ 113 км.
  const MASSIF = 20000
  const MASSIF_ELEV = (10 * Math.PI) / 180
  const massif: HeightSampler = (uv) => (uv[0] < 0.25 ? MASSIF : 0)
  const litAt = (distance: number, p: typeof wideParams): number => {
    const u = 0.25 + arc(distance)
    return terrainShadowMarch(massif, dirAt(u, 0.5), sunTowardWest(u, MASSIF_ELEV), p)
  }
  const distances = [10000, 40000, 60000, 80000, 100000, 150000]

  it('широкая полутень только смягчает: освещённость ≥ узкой на всех дистанциях', () => {
    for (const d of distances) {
      expect(litAt(d, wideParams), `дистанция ${d} м`).toBeGreaterThanOrEqual(litAt(d, narrowParams))
    }
  })

  it('полная тень сохраняется: вплотную за массивом 0, дальше растёт монотонно', () => {
    expect(litAt(10000, wideParams)).toBeLessThan(0.05)

    for (let i = 1; i < distances.length; i++) {
      expect(litAt(distances[i]!, wideParams), `дистанция ${distances[i]} м`).toBeGreaterThanOrEqual(
        litAt(distances[i - 1]!, wideParams)
      )
    }

    expect(litAt(150000, wideParams)).toBe(1)
  })

  it('результаты конечны и лежат в [0, 1]', () => {
    for (const p of [wideParams, narrowParams]) {
      for (const d of distances) {
        const lit = litAt(d, p)

        expect(Number.isFinite(lit)).toBe(true)
        expect(lit).toBeGreaterThanOrEqual(0)
        expect(lit).toBeLessThanOrEqual(1)
      }
    }
  })
})
