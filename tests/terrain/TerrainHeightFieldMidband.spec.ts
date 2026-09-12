import { describe, expect, it } from 'vitest'
import { Vector2, Vector3 } from 'three'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { TERRAIN_MODEL_LEVEL, TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_QUADTREE_MIN_LEVEL } from '@/core/terrain/terrainQuadtreeSelect'
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
  it('MAX_LEVEL 8; добавка ε = residualAmplitudeMeters(шаг уровня); на грубых уровнях — вся полоса, на L8 — 0', () => {
    expect(TERRAIN_QUADTREE_MAX_LEVEL).toBe(8)
    const field = new TerrainHeightField(bumpyMap(), R_KM)
    for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      const step = (2 * Math.PI * R_KM * 1000) / (4 * 2 ** level * 64)
      expect(field.vertexStepMeters(level)).toBeCloseTo(step, 6)
      expect(field.midbandErrorMeters(level)).toBeCloseTo(field.midband!.residualAmplitudeMeters(step), 9)
      if (level > TERRAIN_QUADTREE_MIN_LEVEL) expect(field.midbandErrorMeters(level)).toBeLessThanOrEqual(field.midbandErrorMeters(level - 1) + 1e-9)
    }
    expect(field.midbandErrorMeters(TERRAIN_QUADTREE_MAX_LEVEL)).toBe(0)
    expect(field.midbandErrorMeters(TERRAIN_QUADTREE_MIN_LEVEL)).toBeCloseTo(field.midband!.maxAmplitudeMeters, 9)
  })

  it('отсечение в конструкторе: карта с λ₀ 3000 на R Земли строит 2 октавы, на R Луны — 3', () => {
    const earth = new TerrainHeightField(bumpyMap(), 6371)
    expect(earth.midband!.octaveCount).toBe(2)
    const moon = new TerrainHeightField(bumpyMap(), R_KM)
    expect(moon.midband!.octaveCount).toBe(3)
  })

  it('midbandSample/midbandTilt с шагом уровня: на грубом уровне полоса меньше полной, на L8 совпадает', () => {
    const field = new TerrainHeightField(bumpyMap(), R_KM)
    const d = new Vector3(0.3, 0.5, 0.81).normalize()
    const uv = field.dirToUv(d, new Vector2())
    const out = { heightMeters: 0, tiltE: 0, tiltN: 0, octaveWeightSum: 0 }
    const mapMeters = field.sampleMeters(uv.x, uv.y)
    const full = { ...field.midbandSample(d, uv.x, uv.y, mapMeters, out) }
    const fine = { ...field.midbandSample(d, uv.x, uv.y, mapMeters, out, field.vertexStepMeters(8)) }
    const coarse = { ...field.midbandSample(d, uv.x, uv.y, mapMeters, out, field.vertexStepMeters(2)) }
    expect(fine).toEqual(full)
    expect(coarse.octaveWeightSum).toBeLessThan(full.octaveWeightSum)
    const tilt = field.midbandTilt(d, new Vector2(), field.vertexStepMeters(2))
    expect(tilt.x).toBeCloseTo(coarse.tiltE, 12)
    expect(tilt.y).toBeCloseTo(coarse.tiltN, 12)
  })

  it('geometricErrorMeters(level) = ε карты + добавка; без полосы — ровно ε карты', () => {
    const on = new TerrainHeightField(bumpyMap(), R_KM)
    const off = new TerrainHeightField(bumpyMap(), R_KM, { ...MIDBAND_DEFAULTS, midbandStrength: 0 })
    for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      expect(on.geometricErrorMeters(level)).toBeCloseTo(off.geometricErrorMeters(level) + on.midbandErrorMeters(level), 9)
      expect(on.nodeGeometricErrorMeters(0, level, 0, 0)).toBeCloseTo(off.nodeGeometricErrorMeters(0, level, 0, 0) + on.midbandErrorMeters(level), 9)
    }
  })

  it('экстраполяция глубже TERRAIN_MODEL_LEVEL: ε(7) = ε(6)/2, ε(8) = ε(6)/4 на субтексельной карте (strength 0)', () => {
    // bumpyMap 64×32: шаг вершинной сетки L6 = 64/TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS(16384) ≪ 1
    // текселя — уже на L5/L6 работает линейный (билинейный) хвост terrainLevelScale,
    // не степенной закон самоподобия; ratio ε(5)/ε(6) = 2 ⇒ hurst = log2(2) = 1
    // (кламп MAX_TERRAIN_HURST) ⇒ экстраполяция глубже L6 честно линейна: ровно
    // деление на 2 за уровень, без приближения. Полоса выключена (strength 0) —
    // изолирует ε карты от аналитической добавки полосы.
    const off = new TerrainHeightField(bumpyMap(), R_KM, { ...MIDBAND_DEFAULTS, midbandStrength: 0 })
    const e6 = off.geometricErrorMeters(TERRAIN_MODEL_LEVEL)
    expect(off.geometricErrorMeters(TERRAIN_MODEL_LEVEL + 1)).toBeCloseTo(e6 / 2, 9)
    expect(off.geometricErrorMeters(TERRAIN_MODEL_LEVEL + 2)).toBeCloseTo(e6 / 4, 9)
  })
})

describe('TerrainHeightField: огибающая у уровня воды', () => {
  it('поле с уровнем воды: полоса на урезе гаснет, вдали от уреза — как без уровня', () => {
    const wet = new TerrainHeightField(bumpyMap(), R_KM, { ...MIDBAND_DEFAULTS, waterLevelMeters: 4500, midbandWaterFadeMeters: 100 })
    const dry = new TerrainHeightField(bumpyMap(), R_KM)
    // bumpyMap не гарантирует точку с |h − 4500| < 1 м (проверено — таких нет
    // среди 2000 направлений) — ближайшая к урезу точка ищется явно, порог < 20 м
    let near: { dir: Vector3; h: number } | null = null
    let far = 0
    for (const d of dirs(2000)) {
      const h = dry.mapHeightMeters(d)
      const band = wet.heightMeters(d) - h
      if (Math.abs(h - 4500) > 100) {
        far++
        expect(band).toBeCloseTo(dry.heightMeters(d) - h, 9)
      }
      if (Math.abs(h - 4500) < 20 && (near === null || Math.abs(h - 4500) < Math.abs(near.h - 4500))) {
        near = { dir: d, h }
      }
    }
    expect(far).toBeGreaterThan(100)
    expect(near).not.toBeNull()
    const dryBand = dry.heightMeters(near!.dir) - near!.h
    const wetBand = wet.heightMeters(near!.dir) - near!.h
    expect(Math.abs(wetBand)).toBeLessThan(0.2 * Math.abs(dryBand))
  })
})
