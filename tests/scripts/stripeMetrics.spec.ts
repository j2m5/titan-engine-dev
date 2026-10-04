import { describe, expect, it } from 'vitest'
import { stripeReport } from '../../scripts/lib/stripeMetrics'

const W = 1024
const H = 512

function mulberry32(seed: number): () => number {
  let a = seed

  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Изотропное на сфере гладкое поле: сумма плоских волн в декартовых координатах. */
function sphereField(row: (y: number) => number = () => 1): Float64Array {
  const rnd = mulberry32(3)
  const waves = Array.from({ length: 300 }, () => {
    const z = rnd() * 2 - 1
    const t = rnd() * 2 * Math.PI
    const r = Math.sqrt(1 - z * z)
    const k = 75 + rnd() * 125

    return { k: [Math.cos(t) * r * k, Math.sin(t) * r * k, z * k], ph: rnd() * 2 * Math.PI }
  }, TIMEOUT_MS)
  const field = new Float64Array(W * H)

  for (let y = 0; y < H; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI
    const stretch = row(y)

    for (let x = 0; x < W; x++) {
      const lon = (((x * stretch) % W) / W) * 2 * Math.PI
      const p = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
      let s = 0
      for (const w of waves) s += Math.cos(w.k[0] * p[0] + w.k[1] * p[1] + w.k[2] * p[2] + w.ph)
      field[y * W + x] = s
    }
  }

  return field
}

// Генерация поля тяжёлая — запас на параллельный прогон набора.
const TIMEOUT_MS = 60_000

describe('stripeReport', () => {
  it('изотропное поле: максимум шва близок к медиане', () => {
    const r = stripeReport(sphereField(), W, H, [27.4], 20)

    // Выборочный шум строки даёт max/median порядка 3-4; ступень ×1.5 — ln 1.5 = 0.41.
    expect(r.maxSeam).toBeLessThan(0.1)
    expect(r.maxSeam).toBeLessThan(5 * r.medianSeam)
  }, TIMEOUT_MS)

  it('усиленные EW-разности севернее 40 градусов дают шов у 40', () => {
    const lat40Row = Math.round(((90 - 40) / 180) * H)
    const r = stripeReport(sphereField((y) => (y < lat40Row ? 1.5 : 1)), W, H, [40])

    expect(Math.abs(r.maxSeamLatDeg - 40)).toBeLessThanOrEqual(2)
    expect(r.maxSeam).toBeGreaterThan(5 * r.medianSeam)
  }, TIMEOUT_MS)

  it('checkLatDeg возвращает значение ближайшей строки', () => {
    const r = stripeReport(sphereField(), W, H, [27.4, 48.19])

    expect(r.atLat).toHaveLength(2)
    expect(Math.abs(r.atLat[0].latDeg - 27.4)).toBeLessThan(0.5)
    expect(r.atLat[1].seam).toBeGreaterThanOrEqual(0)
  }, TIMEOUT_MS)
})
