import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { TerrainHeightField, CLEARANCE_MARGIN_METERS } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const dir = (lat: number, lon: number): Vector3 =>
  new Vector3(-Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon))
const floor = (field: TerrainHeightField, p: Vector3): number =>
  field.surfaceRadiusUnits(p) + toThreeJSUnits((field.sagMeters(p) + CLEARANCE_MARGIN_METERS) / 1000)
const data = new Uint16Array(64 * 32)
for (let i = 0; i < data.length; i++) data[i] = (i * 4001) % 65535

describe('полная верхняя граница пола на дуге', () => {
  it('поправляет округлённый вниз Float32-максимум sag в глобальной границе', () => {
    const width = 64,
      height = 512
    const data = Uint16Array.from({ length: width * height }, (_, i) =>
      Math.round(32768 + 32767 * Math.cos((2 * Math.PI * 4 * (i % width)) / width))
    )
    const field = new TerrainHeightField({ width, height, minMeters: -10000, maxMeters: 0, data }, 1000, {
      ...MIDBAND_DEFAULTS,
      midbandStrength: 0
    })
    const d = dir(Math.PI / 2 - (Math.PI * 0.5) / height, (2 * Math.PI * 0.5) / width)
    expect(field.sagMeters(d)).toBeGreaterThan(field.maxSagMeters)
    expect(field.collisionRadiusUpperBoundUnits(d, d.clone().negate())).toBeGreaterThanOrEqual(floor(field, d))
    expect(
      field.collisionRadiusUpperBoundUnits(new Vector3(0, 1, 0), dir(Math.PI / 2 - 0.05, Math.PI / width))
    ).toBeGreaterThanOrEqual(floor(field, d))
  })

  it.each([
    [0.1, 0.2, 0.105, 0.21],
    [0.2, -Math.PI + 0.001, 0.205, Math.PI - 0.001],
    [Math.PI / 2 - 0.0001, 0, Math.PI / 2 - 0.0001, Math.PI],
    [-Math.PI / 2 + 0.0001, 0.4, -Math.PI / 2 + 0.0001, Math.PI + 0.4]
  ])('охватывает DEM, полосу и sag: (%s,%s) → (%s,%s)', (la, lo, lb, lob) => {
    const field = new TerrainHeightField({ width: 64, height: 32, minMeters: -2000, maxMeters: 9000, data }, 1000)
    const a = dir(la, lo),
      b = dir(lb, lob)
    const upper = field.collisionRadiusUpperBoundUnits(a, b)
    for (let i = 0; i <= 100; i++) {
      const d = a
        .clone()
        .lerp(b, i / 100)
        .normalize()
      expect(floor(field, d)).toBeLessThanOrEqual(upper)
    }
  })

  it('сходится к локальному полу, а не максимуму чужого текселя', () => {
    const field = new TerrainHeightField({ width: 64, height: 32, minMeters: -2000, maxMeters: 9000, data }, 1000)
    const a = dir(0.1234, 0.5678),
      b = dir(0.1234 + 1e-10, 0.5678 + 1e-10)
    const upper = field.collisionRadiusUpperBoundUnits(a, b)
    expect(upper).toBeGreaterThanOrEqual(floor(field, a))
    expect(upper - floor(field, a)).toBeLessThan(toThreeJSUnits(0.001))
  })

  it('на плоской карте без полосы сохраняет прежний пяти метровый пол', () => {
    const field = new TerrainHeightField(
      { width: 64, height: 32, minMeters: 0, maxMeters: 0, data: new Uint16Array(2048) },
      1000,
      { ...MIDBAND_DEFAULTS, midbandStrength: 0 }
    )
    expect(field.collisionRadiusUpperBoundUnits(dir(0, 0), dir(0.1, 0.1))).toBeCloseTo(toThreeJSUnits(1000.005), 12)
  })
})
