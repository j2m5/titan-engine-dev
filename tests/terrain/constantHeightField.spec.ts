import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { constantHeightField } from '@/core/terrain/constantHeightField'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'

// Поле воды: вся карта на одном уровне — реальный TerrainHeightField на
// синтетической константной карте, не отдельная реализация интерфейса (см.
// отчёт Task 3). geometricErrorMeters НЕ вырождается в 0 (фикс-раунд 1,
// ревью): у поля без рельефа numerator SSE замещается провисом хорды
// вершинного шага уровня L на сфере радиуса R — ε(L) = R·(1−cos(θ_L/2)),
// θ_L = (π/2)/(2^L·TERRAIN_PATCH_SEGMENTS). Это и есть «деление по кривизне»
// из спеки: дерево самотерминируется в фактической SSE-метрике без ручек.
function expectedEpsilonMeters(radiusKm: number, level: number): number {
  const clamped = Math.min(Math.max(level, 1), 6)
  const theta = Math.PI / 2 / (2 ** clamped * TERRAIN_PATCH_SEGMENTS)
  return radiusKm * 1000 * (1 - Math.cos(theta / 2))
}

describe('constantHeightField: поле без рельефа (уровень воды)', () => {
  it('geometricErrorMeters = провис хорды вершинного шага уровня — НЕ ноль, растёт с приближением к MIN_LEVEL', () => {
    const radiusKm = 6360 // Земля (physicalObjects actorId 7)
    const field = constantHeightField(radiusKm, 0)

    for (let level = 1; level <= 6; level++) {
      expect(field.geometricErrorMeters(level)).toBeCloseTo(expectedEpsilonMeters(radiusKm, level), 6)
    }

    // ε падает с глубиной уровня (вершинный шаг мельче — провис хорды меньше)
    expect(field.geometricErrorMeters(1)).toBeGreaterThan(field.geometricErrorMeters(6))
  })

  it('ε(1) Земли — сотни метров (порядок величины из ревью, ~239 м в центре квада уровня 1)', () => {
    const field = constantHeightField(6360, 0)
    expect(field.geometricErrorMeters(1)).toBeGreaterThan(50)
    expect(field.geometricErrorMeters(1)).toBeLessThan(1000)
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
