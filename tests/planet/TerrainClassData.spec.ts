import { RenderingObjects } from '@storage/database'
import type { IRenderingObject } from '@/core/models/types'
import { TERRAIN_PRESET_KEYS } from '@/core/terrain/terrainClassPresets'

/** Страж: пресет меняет только ручки, не проставленные в БД ни у одного тела. */
describe('Данные классов облика', () => {
  it('ключи пресетов и terrainClass в БД не проставлены', () => {
    const keys = [...TERRAIN_PRESET_KEYS, 'terrainClass']
    const offenders = RenderingObjects.filter((row: IRenderingObject) =>
      keys.some((key) => (row.data as Record<string, unknown> | undefined)?.[key] !== undefined)
    ).map((row: IRenderingObject) => row.id)
    expect(offenders).toEqual([])
  })
})
