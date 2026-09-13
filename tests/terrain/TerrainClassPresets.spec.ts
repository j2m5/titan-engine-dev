import { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { IPlanetRenderingObject } from '@/core/models/types'
import { TERRAIN_CLASS_PRESETS, TERRAIN_PRESET_KEYS, terrainDataOf } from '@/core/terrain/terrainClassPresets'
import { TERRAIN_CLASSES } from '@/core/terrain/terrainClass'

function stubActor(data: Record<string, unknown>): Actor {
  return {
    renderingObject: { getAttribute: () => ({ emission: 1, ...data }) },
    getAttribute: () => 'стаб',
    children: { where: () => ({ first: () => undefined }) },
    resources: { where: () => ({ first: () => undefined }) }
  } as unknown as Actor
}

describe('пресеты классов', () => {
  it('у каждого класса есть пресет; ключи только из разрешённого списка', () => {
    for (const cls of TERRAIN_CLASSES) {
      expect(TERRAIN_CLASS_PRESETS[cls]).toBeDefined()
      for (const key of Object.keys(TERRAIN_CLASS_PRESETS[cls])) expect(TERRAIN_PRESET_KEYS).toContain(key)
    }
  })

  it('стартовые значения спеки §3', () => {
    expect(TERRAIN_CLASS_PRESETS['rocky-airless']).toEqual({ terrainAmbient: 0.1 })
    expect(TERRAIN_CLASS_PRESETS['rocky-atmosphere']).toEqual({ terrainAmbient: 0.18, midbandShade: 0.4, macroTerraceStrength: 0.4 })
    const ice = { terrainAmbient: 0.22, terrainOcclusionDirect: 0.25, steepTint: 0xd9d9d9, midbandShade: 0.35, macroTerraceStrength: 0.2, iceGlintStrength: 0.35 }
    expect(TERRAIN_CLASS_PRESETS['ice-airless']).toEqual(ice)
    expect(TERRAIN_CLASS_PRESETS['ice-atmosphere']).toEqual(ice)
    expect(TERRAIN_CLASS_PRESETS['sand-atmosphere']).toEqual({ terrainAmbient: 0.18, macroStreakStrength: 0.7, macroTerraceStrength: 0.3 })
    expect(TERRAIN_CLASS_PRESETS['sand-airless']).toEqual({ terrainAmbient: 0.12 })
    expect(TERRAIN_CLASS_PRESETS['volcanic-atmosphere']).toEqual({ terrainAmbient: 0.16, steepTint: 0xf2f2f2 })
    expect(TERRAIN_CLASS_PRESETS['volcanic-airless']).toEqual({ terrainAmbient: 0.1, steepTint: 0xf2f2f2 })
  })
})

describe('terrainDataOf', () => {
  it('Европа: пресет льда под данными тела; значения тела сохранены', () => {
    const europa = Actor.find(21)!
    const raw = readRenderingData<IPlanetRenderingObject>(europa)!
    const merged = terrainDataOf(europa)
    expect(merged.terrainAmbient).toBe(0.22)
    expect(merged.iceGlintStrength).toBe(0.35)
    expect(merged.macroStrength).toBe(raw.macroStrength)
    expect(merged.detailSaturation).toBe(raw.detailSaturation)
  })

  it('значение тела главнее пресета; переопределение классом; none — данные тела бит-в-бит', () => {
    expect(terrainDataOf(stubActor({ terrainClass: 'ice-airless', terrainAmbient: 0.05 })).terrainAmbient).toBe(0.05)
    expect(terrainDataOf(stubActor({ terrainClass: 'ice-airless' })).iceGlintStrength).toBe(0.35)
    const none = stubActor({ terrainClass: 'none', steepStart: 0.4 })
    expect(terrainDataOf(none)).toEqual({ emission: 1, terrainClass: 'none', steepStart: 0.4 })
  })

  it('невалидный terrainClass — громкая ошибка с именем тела', () => {
    expect(() => terrainDataOf(stubActor({ terrainClass: 'gas' }))).toThrow('стаб')
  })

  it('тело без класса и без данных — фолбэк как у PlanetShader', () => {
    const bare = { renderingObject: undefined, getAttribute: () => 'стаб', children: { where: () => ({ first: () => undefined }) }, resources: { where: () => ({ first: () => undefined }) } } as unknown as Actor
    expect(terrainDataOf(bare)).toEqual({ bumpScale: 0, emission: 1 })
  })
})
