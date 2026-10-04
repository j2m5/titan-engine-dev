import { describe, expect, it } from 'vitest'
import { defaultMaxLatDeg, stripeReport } from '../../scripts/lib/stripeMetrics'

const W = 512
const H = 256
const MAX_LAT = 70

function mulberry32(seed: number): () => number {
  let a = seed

  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t))

  return c * c * (3 - 2 * c)
}

/**
 * Изотропное на сфере гладкое поле: сумма плоских волн в декартовых координатах.
 * `lonScale(φ)` умножает долготу — EW-волновое число растёт, NS не меняется.
 */
function sphereField(lonScale: (latDeg: number) => number = () => 1): Float64Array {
  const rnd = mulberry32(3)
  const waves = Array.from({ length: 100 }, () => {
    const z = rnd() * 2 - 1
    const t = rnd() * 2 * Math.PI
    const r = Math.sqrt(1 - z * z)
    const k = 38 + rnd() * 62

    return { kx: Math.cos(t) * r * k, ky: Math.sin(t) * r * k, kz: z * k, ph: rnd() * 2 * Math.PI }
  })
  const field = new Float64Array(W * H)

  for (let y = 0; y < H; y++) {
    const latDeg = 90 - ((y + 0.5) / H) * 180
    const lat = (latDeg * Math.PI) / 180
    const scale = lonScale(latDeg)

    for (let x = 0; x < W; x++) {
      const lon = (x / W) * 2 * Math.PI * scale
      const px = Math.cos(lat) * Math.cos(lon)
      const py = Math.cos(lat) * Math.sin(lon)
      const pz = Math.sin(lat)
      let s = 0
      for (const w of waves) s += Math.cos(w.kx * px + w.ky * py + w.kz * pz + w.ph)
      field[y * W + x] = s
    }
  }

  return field
}

const isotropic = sphereField()
// Долгота ×2 севернее 40° (плавно, на 2°): EW-разности вдвое больше без скачка поля.
const stepped = sphereField((latDeg) => 1 + smoothstep((latDeg - 39) / 2))

describe('stripeReport', () => {
  it('изотропное поле: швы малы при окне по умолчанию и при широком', () => {
    const narrow = stripeReport(isotropic, W, H, [27.4], 6, MAX_LAT)
    const wide = stripeReport(isotropic, W, H, [27.4], 20, MAX_LAT)

    expect(narrow.maxSeam).toBeLessThan(0.25)
    // Выборочный шум строки даёт max/median порядка 3-4; ступень ×2 — ln 2 = 0.69.
    expect(wide.maxSeam).toBeLessThan(0.1)
    expect(wide.maxSeam).toBeLessThan(5 * wide.medianSeam)
  })

  it('усиленные EW-разности севернее 40 градусов дают шов у 40', () => {
    const r = stripeReport(stepped, W, H, [40], 6, MAX_LAT)

    expect(Math.abs(r.maxSeamLatDeg - 40)).toBeLessThanOrEqual(2)
    expect(r.maxSeam).toBeGreaterThan(5 * r.medianSeam)
    expect(r.atLat[0].seam).toBeCloseTo(r.maxSeam, 6)
  })

  it('checkLatDeg: пик шва в окне вокруг широты, не значение одной строки', () => {
    const r = stripeReport(stepped, W, H, [38, 41.5], 6, MAX_LAT)

    for (const a of r.atLat) {
      expect(a.seam).toBeCloseTo(r.maxSeam, 6)
      expect(Math.abs(a.peakLatDeg - r.maxSeamLatDeg)).toBeLessThan(0.01)
    }
  })

  it('широта вне полосы — NaN, а не ближайшая строка', () => {
    const r = stripeReport(isotropic, W, H, [27.4, 80], 6, MAX_LAT)

    expect(Number.isFinite(r.atLat[0].seam)).toBe(true)
    expect(r.atLat[1].seam).toBeNaN()
    expect(r.atLat[1].peakLatDeg).toBeNaN()
  })

  it('полоса по умолчанию: ≥ 800 текселей в строке', () => {
    expect(defaultMaxLatDeg(8192)).toBeCloseTo(84.4, 1)
    expect(defaultMaxLatDeg(4096)).toBeCloseTo(78.7, 1)
    expect(defaultMaxLatDeg(512)).toBe(0)
  })
})
