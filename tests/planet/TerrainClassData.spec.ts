import { RenderingObjects } from '@storage/database'
import type { IRenderingObject } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { TERRAIN_PRESET_KEYS } from '@/core/terrain/terrainClassPresets'
import { terrainClassOf } from '@/core/terrain/terrainClass'

/** Индивидуальные настройки облика закреплены только у лун Darkness. */
describe('Данные классов облика', () => {
  it('только луны Darkness переопределяют фон рельефа и силу террас', () => {
    const keys = [...TERRAIN_PRESET_KEYS, 'terrainClass']
    const withOverrides = RenderingObjects.filter((row: IRenderingObject) =>
      keys.some((key) => (row.data as Record<string, unknown> | undefined)?.[key] !== undefined)
    )
    expect(withOverrides.map((row) => row.actorId).sort((a, b) => a - b)).toEqual([
      150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161
    ])
    for (const row of withOverrides) {
      const explicit = Object.fromEntries(keys.filter((key) => row.data[key] !== undefined).map((key) => [key, row.data[key]]))
      expect(explicit, `actorId ${row.actorId}`).toEqual({
        terrainAmbient: 0,
        macroTerraceStrength: terrainClassOf(Actor.find(row.actorId)!) === 'ice-airless' ? 0.15 : 0.35
      })
    }
  })
})
