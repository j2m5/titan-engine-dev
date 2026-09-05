import { describe, expect, it } from 'vitest'
import { Vector2, Vector3 } from 'three'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_QUADTREE_MIN_LEVEL } from '@/core/terrain/terrainQuadtreeSelect'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}
const R_KM = 1736
function bumpyMap(): HeightMapData {
  const w = 64, h = 32
  const values = Array.from({ length: w * h }, (_, k) => (k * 4001) % 65535)
  return makeMap(w, h, values, -2000, 9000)
}
function dirs(n: number): Vector3[] {
  return Array.from({ length: n }, (_, k) => {
    const y = 1 - (2 * (k + 0.5)) / n
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    return new Vector3(r * Math.cos(k * 2.399963), y, r * Math.sin(k * 2.399963))
  })
}

describe('TerrainHeightField: геометрия средней полосы в каноне высоты', () => {
  it('strength 0 — heightMeters бит-в-бит как без параметров; midband null, бонды 0', () => {
    // Пинит: при strength 0 heightMeters тождественно raw-карте (sampleMeters), без вклада полосы.
    const off = new TerrainHeightField(bumpyMap(), R_KM, { ...MIDBAND_DEFAULTS, midbandStrength: 0 })
    expect(off.midband).toBeNull()
    expect(off.midbandSlopeBound).toBe(0)
    expect(off.maxHeightWithMidbandMeters).toBe(off.maxMeters)
    for (const d of dirs(200)) {
      const uv = off.dirToUv(d, new Vector2())
      expect(off.heightMeters(d)).toBe(off.sampleMeters(uv.x, uv.y))
    }
  })

  it('по умолчанию (без параметров) полоса ВКЛЮЧЕНА: высота = карта + mid, |mid| ≤ maxAmplitude', () => {
    const field = new TerrainHeightField(bumpyMap(), R_KM)
    const plain = new TerrainHeightField(bumpyMap(), R_KM, { ...MIDBAND_DEFAULTS, midbandStrength: 0 })
    expect(field.midband).not.toBeNull()
    let maxDelta = 0
    for (const d of dirs(1000)) maxDelta = Math.max(maxDelta, Math.abs(field.heightMeters(d) - plain.heightMeters(d)))
    expect(maxDelta).toBeGreaterThan(0)
    expect(maxDelta).toBeLessThanOrEqual(field.midband!.maxAmplitudeMeters)
    expect(field.maxHeightWithMidbandMeters).toBeCloseTo(field.maxMeters + field.midband!.maxAmplitudeMeters, 9)
  })

  it('midbandTilt: наклон полосы совпадает с конечной разностью высоты по дуге (E/N), полюс — 0', () => {
    const field = new TerrainHeightField(bumpyMap(), R_KM)
    const plain = new TerrainHeightField(bumpyMap(), R_KM, { ...MIDBAND_DEFAULTS, midbandStrength: 0 })
    const R_M = R_KM * 1000
    const hArc = 0.05
    const up = new Vector3(0, 1, 0)
    const tilt = new Vector2()
    let worst = 0
    for (const d of dirs(200)) {
      const e = new Vector3().crossVectors(up, d)
      if (e.length() < 1e-3) continue
      e.normalize()
      const n = new Vector3().crossVectors(d, e)
      field.midbandTilt(d, tilt)
      const mid = (p: Vector3): number => field.heightMeters(p) - plain.heightMeters(p)
      const dE1 = d.clone().addScaledVector(e, hArc / R_M).normalize()
      const dE0 = d.clone().addScaledVector(e, -hArc / R_M).normalize()
      const dN1 = d.clone().addScaledVector(n, hArc / R_M).normalize()
      const dN0 = d.clone().addScaledVector(n, -hArc / R_M).normalize()
      worst = Math.max(worst, Math.abs(tilt.x - (mid(dE1) - mid(dE0)) / (2 * hArc)), Math.abs(tilt.y - (mid(dN1) - mid(dN0)) / (2 * hArc)))
    }
    expect(worst).toBeLessThan(2e-2) // огибающая билинейна по сетке (ячейка ~10 км) — её производная в наклон не входит намеренно, отсюда допуск шире, чем у поля
    field.midbandTilt(new Vector3(0, 1, 0), tilt)
    expect(tilt.x).toBe(0)
    expect(tilt.y).toBe(0)
  })

  it('slopeBound накрывает замер max |∇mid| по 3000 направлениям', () => {
    const field = new TerrainHeightField(bumpyMap(), R_KM)
    const tilt = new Vector2()
    let maxTilt = 0
    for (const d of dirs(3000)) maxTilt = Math.max(maxTilt, field.midbandTilt(d, tilt).length())
    expect(maxTilt).toBeLessThanOrEqual(field.midbandSlopeBound)
    expect(field.midbandSlopeBound).toBeLessThan(3) // ≈ 2.8 при GRAD_BOUND 7 и варпе 0.35; с бондом архива (27.6) было бы ≈ 29 и марш коллизии замедлился бы в ~10 раз
  })
})

describe('ε-пирамида с полосой B', () => {
  it('MAX_LEVEL 8; добавка ε равна p99 октав короче 2·шага уровня; на грубых уровнях 0', () => {
    expect(TERRAIN_QUADTREE_MAX_LEVEL).toBe(8)
    const field = new TerrainHeightField(bumpyMap(), R_KM)
    const R_M = R_KM * 1000
    for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      const step = (2 * Math.PI * R_M) / (4 * 2 ** level * 64)
      expect(field.midbandErrorMeters(level)).toBeCloseTo(field.midband!.p99AmplitudeBelowMeters(2 * step), 9)
    }
    // L1: шаг ~21 км, все волны (≤1.6 км) короче → добавка = полный p99; L8: шаг 167 м → 2·шаг = 333 м < 400 м → 0
    expect(field.midbandErrorMeters(TERRAIN_QUADTREE_MAX_LEVEL)).toBe(0)
    expect(field.midbandErrorMeters(TERRAIN_QUADTREE_MIN_LEVEL)).toBeCloseTo(field.midband!.maxAmplitudeMeters, 9)
  })

  it('geometricErrorMeters(level) = ε карты + добавка; без полосы — ровно ε карты', () => {
    const on = new TerrainHeightField(bumpyMap(), R_KM)
    const off = new TerrainHeightField(bumpyMap(), R_KM, { ...MIDBAND_DEFAULTS, midbandStrength: 0 })
    for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      expect(on.geometricErrorMeters(level)).toBeCloseTo(off.geometricErrorMeters(level) + on.midbandErrorMeters(level), 9)
      expect(on.nodeGeometricErrorMeters(0, level, 0, 0)).toBeCloseTo(off.nodeGeometricErrorMeters(0, level, 0, 0) + on.midbandErrorMeters(level), 9)
    }
  })
})
