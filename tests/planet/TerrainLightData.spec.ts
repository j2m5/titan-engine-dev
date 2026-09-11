import { RenderingObjects } from '@storage/database'
import { IRenderingObject } from '@/core/models/types'

/** Страж данных арки «Свет»: сегодня вакуумный — ручки глобальные, первая правка БД владельца его разбудит. */
describe('Данные света суши', () => {
  it('ручки света и steepTint в БД не проставлены — дефолты живут в резолверах', () => {
    const keys = ['terrainOcclusionDirect', 'skyAmbientStrength', 'cloudShadowStrength', 'cloudShadowHeightKm', 'steepTint', 'terrainShadowStrength', 'terrainShadowSoftness']
    const withLight = RenderingObjects.filter((row: IRenderingObject): boolean =>
      keys.some((key: string): boolean => (row.data as Record<string, unknown> | undefined)?.[key] !== undefined)
    )
    expect(withLight).toEqual([])
  })
})
