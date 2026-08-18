import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { constantHeightField } from '@/core/terrain/constantHeightField'
import { toThreeJSUnits } from '@/core/helpers/scaling'

// Поле воды: вся карта на одном уровне — реальный TerrainHeightField на
// синтетической константной карте, без отдельного интерфейса поля (см. отчёт
// Task 3 — минимальная по интрузии реализация).
describe('constantHeightField: поле без рельефа (уровень воды)', () => {
  it('geometricErrorMeters ≡ 0 на всех уровнях — SSE-порог не пробивается никогда', () => {
    const field = constantHeightField(1000, 0)
    for (let level = 1; level <= 6; level++) {
      expect(field.geometricErrorMeters(level)).toBe(0)
    }
  })

  it('heightMeters ≡ уровень в любом направлении', () => {
    const field = constantHeightField(1000, -667.2)
    const dirs = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 1, 1).normalize()]
    for (const dir of dirs) expect(field.heightMeters(dir)).toBeCloseTo(-667.2, 6)
  })

  it('surfaceRadiusUnits = toThreeJSUnits(R + уровень/1000) — отрицательный уровень даёт оболочку ПОД R', () => {
    const radiusKm = 1000
    const levelMeters = -667.2
    const field = constantHeightField(radiusKm, levelMeters)
    const expected = toThreeJSUnits(radiusKm + levelMeters / 1000)

    expect(field.surfaceRadiusUnits(new Vector3(1, 0, 0))).toBeCloseTo(expected, 9)
  })

  it('положительный уровень даёт оболочку НАД R', () => {
    const field = constantHeightField(1000, 500)
    expect(field.surfaceRadiusUnits(new Vector3(0, 1, 0))).toBeGreaterThan(toThreeJSUnits(1000))
  })
})
