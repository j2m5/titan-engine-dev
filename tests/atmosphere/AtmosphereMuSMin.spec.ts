import { RenderingObjects } from '@storage/database'

type AtmosphereRow = {
  id: number
  data: { bottomRadius?: number; topRadius?: number; muSMin?: number; solarIrradiance?: number[] }
}

/**
 * Отсечка LUT по глубине солнца под горизонтом: всё глубже muSMin зажимается
 * на крайний тексель, и ненулевая энергия там (мультискаттер толстых атмосфер)
 * подсвечивает ВСЮ ночную сторону плато. Правило проекта (03.07.2026):
 * muSMin = −sin(1.6·dip + 5°), dip = asin(√(1 − (bottom/top)²)) — погружение
 * горизонта с верха атмосферы. Глубже формулы — безопасно (запас), мельче —
 * симптом. Земля (id 14) — единственное исключение: её оставили на запасе
 * Брунетона (depression 12° при dip 7.8°).
 */
const EARTH_ATMOSPHERE_ID = 14

function muSMinByDip(bottom: number, top: number): number {
  const dip = Math.asin(Math.sqrt(1 - (bottom / top) ** 2))
  return -Math.sin(1.6 * dip + (5 * Math.PI) / 180)
}

function atmosphereRows(): AtmosphereRow[] {
  return (RenderingObjects as unknown as AtmosphereRow[]).filter(
    (r) => Array.isArray(r.data.solarIrradiance) && r.id !== EARTH_ATMOSPHERE_ID
  )
}

describe('muSMin атмосфер не мельче формулы погружения горизонта', () => {
  it('набор не пуст и у каждой строки есть радиусы и muSMin', () => {
    const rows = atmosphereRows()
    expect(rows.length).toBeGreaterThanOrEqual(17)
    for (const row of rows) {
      expect(typeof row.data.bottomRadius).toBe('number')
      expect(typeof row.data.topRadius).toBe('number')
      expect(typeof row.data.muSMin).toBe('number')
    }
  })

  it.each(atmosphereRows().map((r) => [r.id, r] as const))('строка %i', (_id, row) => {
    const expected = muSMinByDip(row.data.bottomRadius!, row.data.topRadius!)
    // Допуск 1e-3 покрывает округление до четырёх знаков в БД.
    expect(row.data.muSMin!).toBeLessThanOrEqual(expected + 1e-3)
  })
})
