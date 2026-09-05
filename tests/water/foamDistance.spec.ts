import { describe, expect, it } from 'vitest'
import { foamDistanceMeters, linearShelfSampler, shoreBand } from './foamDistanceMirror'

// Земля: тексель 4.88 км (8192 по экватору R 6360 км); шельф 1/100 и 1/1000
const TEXEL_METERS = 4878
const WIDTH = 64
const TEXEL_UV = { x: 1 / WIDTH, y: 1 / 32 }
// Экватор, изотропный случай: u- и v-тексель совпадают, cosLat=1 (дефолт)
const TEXEL_M = { x: TEXEL_METERS, y: TEXEL_METERS }

function trueDistanceMeters(u: number): number {
  return (u - 0.5) * WIDTH * TEXEL_METERS
}

describe('пена: расстояние до уреза из градиента канала A (CPU-зеркало спеки §1.1/§1.2)', () => {
  for (const slope of [1 / 100, 1 / 1000]) {
    it(`шельф ${slope}: dist восстанавливается с точностью до текселя в зоне накатов`, () => {
      const sampleA = linearShelfSampler(slope, WIDTH, TEXEL_METERS)
      // от 1 текселя от уреза до насыщения канала A (200 м глубины: 1/100 → ~4 текселя, 1/1000 → 41),
      // минус ещё один тексель — вынос прямой разности aE; кап 4 — зона накатов заведомо уже 1 текселя
      const kMax = Math.min(4, Math.floor(200 / (slope * TEXEL_METERS)) - 2)
      expect(kMax).toBeGreaterThanOrEqual(2)
      for (let k = 1; k <= kMax; k++) {
        const u = 0.5 + (k * TEXEL_METERS + 0.37 * TEXEL_METERS) / (WIDTH * TEXEL_METERS)
        const dist = foamDistanceMeters(sampleA, u, 0.5, TEXEL_UV, TEXEL_M)
        expect(Math.abs(dist - trueDistanceMeters(u))).toBeLessThan(TEXEL_METERS)
      }
    })
  }

  it('ширина каймы в метрах не зависит от уклона шельфа (в этом смысл нормировки)', () => {
    const shoreMeters = 600
    const widths: number[] = []
    for (const slope of [1 / 100, 1 / 1000]) {
      const sampleA = linearShelfSampler(slope, WIDTH, TEXEL_METERS)
      // шаг 10 м по u внутри первого текселя за урезом; кайма = где shoreBand > 0.5
      let lastInside = 0
      for (let m = 0; m <= 2 * TEXEL_METERS; m += 10) {
        const u = 0.5 + m / (WIDTH * TEXEL_METERS)
        if (shoreBand(foamDistanceMeters(sampleA, u, 0.5, TEXEL_UV, TEXEL_M), shoreMeters) > 0.5) lastInside = m
      }
      widths.push(lastInside)
    }
    // со смещением уреза texel/3 кайма 600 м занимает ~0.15 текселя истины на обоих уклонах;
    // квант канала A на шельфе 1/1000 (риск спеки №3) не должен схлопнуть или удвоить её
    expect(widths[0]).toBeGreaterThan(200)
    expect(widths[1]).toBeGreaterThan(200)
    expect(Math.abs(widths[0] - widths[1]) / Math.max(widths[0], widths[1])).toBeLessThan(0.5)
  })

  it('на самом урезе оценка ≈ 0 при обоих уклонах — смещение texel/3 не зависит от уклона', () => {
    for (const slope of [1 / 100, 1 / 1000]) {
      const sampleA = linearShelfSampler(slope, WIDTH, TEXEL_METERS)
      // квант 1/255 на пологом шельфе даёт отклонение от точного texel/3 — допуск 50 м
      expect(foamDistanceMeters(sampleA, 0.5, 0.5, TEXEL_UV, TEXEL_M)).toBeLessThan(50)
    }
  })

  it('плоское дно (градиент под полом) — расстояние уходит за зону накатов, пены нет', () => {
    const flat = (): number => 0.5
    const dist = foamDistanceMeters(flat, 0.7, 0.5, TEXEL_UV, TEXEL_M)
    expect(dist).toBeGreaterThan(100_000)
    expect(shoreBand(dist, 600)).toBe(0)
  })

  it('суша (A = 0) — dist = 0 (смещение клампится нулём), кайма полная, но её гасит альфа воды', () => {
    const sampleA = linearShelfSampler(1 / 100, WIDTH, TEXEL_METERS)
    expect(foamDistanceMeters(sampleA, 0.2, 0.5, TEXEL_UV, TEXEL_M)).toBe(0)
  })

  it('шельф с градиентом на юг даёт те же dist, что на восток — оси не путаются местами (спека §1.2)', () => {
    const slope = 1 / 1000
    const eastSampler = linearShelfSampler(slope, WIDTH, TEXEL_METERS)
    const southSampler = linearShelfSampler(slope, WIDTH, TEXEL_METERS, 200, 'v')
    for (const k of [1, 2, 3]) {
      const east = 0.5 + (k * TEXEL_METERS + 0.37 * TEXEL_METERS) / (WIDTH * TEXEL_METERS)
      const south = 0.5 - (k * TEXEL_METERS + 0.37 * TEXEL_METERS) / (32 * TEXEL_METERS)
      const distEast = foamDistanceMeters(eastSampler, east, 0.5, TEXEL_UV, TEXEL_M)
      const distSouth = foamDistanceMeters(southSampler, 0.5, south, TEXEL_UV, TEXEL_M)
      expect(Math.abs(distSouth - distEast) / distEast).toBeLessThan(0.01)
    }
  })

  it('на широте 60° (cosLat 0.5) восточный шельф: dist в метрах тот же, что на экваторе', () => {
    const slope = 1 / 1000
    // метры на тексель у широты 60° = TEXEL_METERS·cosLat — сэмплер строится по РЕАЛЬНЫМ метрам
    const sampler = linearShelfSampler(slope, WIDTH, TEXEL_METERS * 0.5)
    for (let k = 1; k <= 3; k++) {
      const u = 0.5 + (k * TEXEL_METERS * 0.5 + 0.37 * TEXEL_METERS * 0.5) / (WIDTH * TEXEL_METERS * 0.5)
      // texelMeters передан ЭКВАТОРИАЛЬНЫМ (TEXEL_METERS), cosLat=0.5 сжимает u-тексель внутри формулы —
      // без фикса (старый скаляр × общий cosLat на оба гейта) ошибка была бы вдвое больше допуска
      const dist = foamDistanceMeters(sampler, u, 0.5, TEXEL_UV, TEXEL_M, 0.5)
      const truth = (u - 0.5) * WIDTH * TEXEL_METERS * 0.5
      expect(Math.abs(dist - truth)).toBeLessThan(TEXEL_METERS * 0.5)
    }
  })
})
