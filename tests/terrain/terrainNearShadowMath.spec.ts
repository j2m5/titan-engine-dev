import { describe, expect, it } from 'vitest'
import {
  NEAR_SHADOW_BIAS_SLOPE,
  NEAR_SHADOW_STEPS,
  combineTerrainShadow,
  dirToTile,
  nearAltitudeWeight,
  nearEdgeWeight,
  nearShadowMarch,
  nearTileBasis,
  texelCenter,
  tileToDir,
  type TileSampler,
  type Vec3
} from '@/core/terrain/terrainNearShadowMath'
import { config } from '@/core/framework/config'

const R = 1737.4e3
const TEXEL = 64
const DEG = Math.PI / 180

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: Vec3): number => Math.sqrt(dot(a, a))
const norm = (a: Vec3): Vec3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l] }

/** Солнце на высоте el над местным горизонтом d, с азимута az (касательный вектор, ортогонализуется к d). */
function sunAt(d: Vec3, az: Vec3, el: number): Vec3 {
  const k = dot(az, d)
  const t = norm([az[0] - d[0] * k, az[1] - d[1] * k, az[2] - d[2] * k])
  const s = Math.sin(el), co = Math.cos(el)
  return [d[0] * s + t[0] * co, d[1] * s + t[1] * co, d[2] * s + t[2] * co]
}

const CENTERS: Vec3[] = [norm([0.3, 0.5, 0.81]), [0, 0, 1], [0, 1, 0], [0, -1, 0], norm([1e-6, 1, 0]), norm([-0.7, -0.2, 0.1])]

describe('terrainNearShadowMath: базис и проекция плитки', () => {
  it('константы марша: 16 шагов, смещение 0.05 текселя', () => {
    expect(NEAR_SHADOW_STEPS).toBe(16)
    expect(NEAR_SHADOW_BIAS_SLOPE).toBe(0.05)
  })

  it('nearTileBasis ортонормален и правый (E × N = c), в т.ч. у полюсов', () => {
    for (const c of CENTERS) {
      const { east, north } = nearTileBasis(c)
      expect(len(east)).toBeCloseTo(1, 12)
      expect(len(north)).toBeCloseTo(1, 12)
      expect(dot(east, north)).toBeCloseTo(0, 12)
      expect(dot(east, c)).toBeCloseTo(0, 12)
      expect(dot(north, c)).toBeCloseTo(0, 12)
      const cross: Vec3 = [
        east[1] * north[2] - east[2] * north[1],
        east[2] * north[0] - east[0] * north[2],
        east[0] * north[1] - east[1] * north[0]
      ]
      for (let i = 0; i < 3; i++) expect(cross[i]).toBeCloseTo(c[i], 12)
    }
  })

  it('E = normalize(UP × c), N = c × E; на полюсе E = (1, 0, 0)', () => {
    const { east, north } = nearTileBasis([0, 0, 1])
    expect(east[0]).toBe(1)
    expect(Math.abs(east[1]) + Math.abs(east[2])).toBe(0)
    expect(north[1]).toBeCloseTo(1, 15)
    const pole = nearTileBasis([0, 1, 0])
    expect(pole.east[0]).toBe(1)
    expect(Math.abs(pole.east[1]) + Math.abs(pole.east[2])).toBe(0)
    expect(pole.north[2]).toBeCloseTo(-1, 15)
  })

  it('dirToTile ∘ tileToDir — тождество до 1e-9 (и центр полюса)', () => {
    for (const c of CENTERS) {
      const { east, north } = nearTileBasis(c)
      for (const [x, y] of [[0, 0], [16384, -16384], [-7000.5, 3210.25], [100, 0]] as const) {
        const d = tileToDir(x, y, c, east, north, R)
        expect(len(d)).toBeCloseTo(1, 14)
        const [x2, y2] = dirToTile(d, c, east, north, R)
        expect(Math.abs(x2 - x)).toBeLessThan(1e-9)
        expect(Math.abs(y2 - y)).toBeLessThan(1e-9)
      }
    }
  })

  it('проекция гномоническая: (x, y) = R·(d·E, d·N)/(d·c); центр — (0, 0)', () => {
    const c = CENTERS[0]
    const { east, north } = nearTileBasis(c)
    for (const v of dirToTile(c, c, east, north, R)) expect(Math.abs(v)).toBeLessThan(1e-6)
    const d = norm([0.31, 0.49, 0.8])
    const [x, y] = dirToTile(d, c, east, north, R)
    expect(x).toBeCloseTo(R * dot(d, east) / dot(d, c), 6)
    expect(y).toBeCloseTo(R * dot(d, north) / dot(d, c), 6)
  })

  it('texelCenter: (i + 0.5 − texels/2)·texel', () => {
    expect(texelCenter(0, 512, 64)).toBe(-16352)
    expect(texelCenter(511, 512, 64)).toBe(16352)
    expect(texelCenter(256, 512, 64)).toBe(32)
    expect(texelCenter(255, 512, 64)).toBe(-32)
  })
})

describe('terrainNearShadowMath: марш', () => {
  const c = CENTERS[0]
  const { east, north } = nearTileBasis(c)
  const west: Vec3 = [-east[0], -east[1], -east[2]]
  const p = { radiusMeters: R, texelMeters: TEXEL, maxDistanceMeters: 8000, penumbraTan: 0.005 }
  const flat: TileSampler = () => 0

  // Столовая гора 300 м радиуса 1 км в (0, 0); солнце 5° с запада: тень на восток длиной L ≈ 3.43 км от кромки.
  const HILL_H = 300, HILL_R = 1000
  const L = HILL_H / Math.tan(5 * DEG)
  const hill: TileSampler = (x, y) => (Math.hypot(x, y) <= HILL_R ? HILL_H : 0)

  function marchAt(x0: number, sampler: TileSampler, el: number, az: Vec3 = west, params = p): number {
    const d = tileToDir(x0, 0, c, east, north, R)
    return nearShadowMarch(sampler, d, sunAt(d, az, el), c, east, north, params)
  }

  it('холм 300 м при солнце 5°: на 0.5·L за кромкой — тень, на 1.5·L — свет', () => {
    expect(marchAt(HILL_R + 0.5 * L, hill, 5 * DEG)).toBe(0)
    expect(marchAt(HILL_R + 1.5 * L, hill, 5 * DEG)).toBe(1)
    // Солнце с востока — холм позади, тени нет.
    expect(marchAt(HILL_R + 0.5 * L, hill, 5 * DEG, east)).toBe(1)
  })

  it('ровная плитка: солнце +10° — свет, −5° — тень (раннего выхода по горизонту нет)', () => {
    expect(marchAt(0, flat, 10 * DEG)).toBe(1)
    expect(marchAt(0, flat, -5 * DEG)).toBe(0)
  })

  it('солнце в зените — проекции на плитку нет, свет', () => {
    const d = tileToDir(500, -300, c, east, north, R)
    expect(nearShadowMarch(() => 1e6, d, c, c, east, north, p)).toBe(1)
  })

  it('кривизна: ровная плитка, солнце +0.01° — свет', () => {
    expect(marchAt(0, flat, 0.01 * DEG)).toBe(1)
  })

  // Солнце ровно на горизонте фрагмента в центре плитки (sinθ = 0); стена за 6 км против солнца.
  // Луч на последнем шаге s = 8000 м поднимается над сферой на s²/(2R) ≈ 18.42 м; bias = 3.2 м.
  // Стена на 1 м ниже hRay + bias — свет, на 1 м выше — тень. Без члена кривизны (hRay = 0)
  // или с обратным знаком (hRay = −18.42) низкая стена тоже даёт тень — тест это ловит.
  it('кривизна: высота луча на 8 км = s²/(2R) (ручной расчёт), знак — луч уходит над сферой', () => {
    const s = 8000
    const lift = (s * s) / (2 * R)
    expect(lift).toBeCloseTo(18.42, 2)
    const bias = TEXEL * NEAR_SHADOW_BIAS_SLOPE
    const sharp = { ...p, penumbraTan: 1e-4 }
    const wall = (h: number): TileSampler => (x) => (x < -6000 ? h : 0)
    const d = c
    const sun = west
    expect(nearShadowMarch(wall(lift + bias - 1), d, sun, c, east, north, sharp)).toBe(1)
    expect(nearShadowMarch(wall(lift + bias + 1), d, sun, c, east, north, sharp)).toBe(0)
  })

  it('h₀ берётся из плитки в точке фрагмента: фрагмент на плато −30 м против стены 0 м', () => {
    // Луч из −30 м горизонтально: на 8 км он на −30 + 18.42 м — ниже стены 0 м → тень.
    const pit: TileSampler = (x) => (x < -6000 ? 0 : -30)
    const sharp = { ...p, penumbraTan: 1e-4 }
    expect(nearShadowMarch(pit, c, west, c, east, north, sharp)).toBe(0)
    // Тот же перепад, но стена на 12 м ниже: −30 + 18.42 − 3.2 > −42 → свет.
    const low: TileSampler = (x) => (x < -6000 ? -42 : -30)
    expect(nearShadowMarch(low, c, west, c, east, north, sharp)).toBe(1)
  })

  it('полутень: частичное затенение в (0, 1)', () => {
    const v = marchAt(HILL_R + 0.5 * L, hill, 5 * DEG, west, { ...p, penumbraTan: 1 })
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
  })
})

describe('terrainNearShadowMath: веса и сложение', () => {
  it('высотный вес: 1 / 0.5 / 0 на 30 / 40 / 50 км', () => {
    expect(nearAltitudeWeight(0, 30000, 50000)).toBe(1)
    expect(nearAltitudeWeight(30000, 30000, 50000)).toBe(1)
    expect(nearAltitudeWeight(40000, 30000, 50000)).toBeCloseTo(0.5, 12)
    expect(nearAltitudeWeight(50000, 30000, 50000)).toBe(0)
    expect(nearAltitudeWeight(80000, 30000, 50000)).toBe(0)
  })

  it('краевой вес: 1 внутри 0.8·half, 0 на краю, по max(|x|, |y|)', () => {
    const half = 16384
    expect(nearEdgeWeight(0, 0, half)).toBe(1)
    expect(nearEdgeWeight(0.8 * half, -0.8 * half, half)).toBe(1)
    expect(nearEdgeWeight(0.9 * half, 0, half)).toBeCloseTo(0.5, 12)
    expect(nearEdgeWeight(0, -0.9 * half, half)).toBeCloseTo(0.5, 12)
    expect(nearEdgeWeight(0, half, half)).toBe(0)
    expect(nearEdgeWeight(-half, 0.1, half)).toBe(0)
  })

  it('combineTerrainShadow = min(far, mix(1, near, weight))', () => {
    expect(combineTerrainShadow(0.7, 0.2, 0)).toBe(0.7)
    expect(combineTerrainShadow(0.7, 0.2, 1)).toBe(0.2)
    expect(combineTerrainShadow(0.3, 0.8, 1)).toBe(0.3)
    expect(combineTerrainShadow(1, 0.2, 0.5)).toBeCloseTo(0.6, 12)
  })
})

describe('конфиг terrain.nearShadow', () => {
  it('значения Global Constraints', () => {
    expect(config('terrain.nearShadow')).toEqual({
      tileTexels: 512,
      texelMeters: 64,
      maxDistanceMeters: 8000,
      maxAltitudeMeters: 50000,
      fadeAltitudeMeters: 30000,
      rebakeFraction: 0.25
    })
  })
})
