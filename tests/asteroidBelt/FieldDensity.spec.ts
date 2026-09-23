import { describe, it, expect, vi } from 'vitest'
import { Vector3 } from 'three'
import '@/core/framework/TitanThree'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => ({ name: 'ring.png' }),
    getTextureOrMake: () => ({ name: 'ring.png' })
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { deriveCascades } from '@/core/renderables/DetailedRingStreamingSystem/cascadeScale'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { AU } from '@/core/constants'
import { Actors, RenderingObjects } from '@storage/database'
import { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import { measureBeltField } from '../helpers/beltField'

/** Строка «Ashfall Belt» — реальный пояс системы W26 из поставляемой базы, не синтетика */
function beltActorFromDatabase(): Actor {
  const actorRow = Actors.find((a) => a.name === 'Ashfall Belt')
  if (!actorRow) throw new Error('в поставляемой базе нет актора Ashfall Belt')
  const renderingRow = RenderingObjects.find((r) => r.actorId === actorRow.id)
  if (!renderingRow) throw new Error('у Ashfall Belt нет строки renderingObject в поставляемой базе')
  const data = renderingRow.data as unknown as IAsteroidBeltRenderingObject

  return {
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (key: string, fallback: unknown = ''): unknown => {
      if (key === 'categoryId') return actorRow.categoryId
      if (key === 'name') return actorRow.name
      if (key === 'id') return actorRow.id
      return fallback
    }
  } as unknown as Actor
}

// Каскады той же строки — источник границ классов размеров для проверки разнообразия калибров
const beltData = RenderingObjects.find(
  (r) => r.actorId === Actors.find((a) => a.name === 'Ashfall Belt')?.id
)!.data as unknown as IAsteroidBeltRenderingObject
const cascades = deriveCascades({
  sizeRangeKm: beltData.sizeRangeKm,
  spacingKm: beltData.spacingKm,
  halfThicknessKm: beltData.thicknessAu * AU * 0.5
})

describe('Поле пояса изнутри: что реально перед камерой', () => {
  it('камера в средней плоскости на 50 а.е. — плотное поле, а не пустота', () => {
    const belt = new AsteroidBelt(beltActorFromDatabase())
    const field = measureBeltField(belt, new Vector3(fromAstronomicalUnits(50), 0, 0))

    // Тела есть вообще (замерено 38 676, порог с запасом)
    expect(field.total).toBeGreaterThan(20000)
    // Ближайшее тело — десятки км, а не сотни тысяч (замерено 2.4 км на 39 км)
    expect(field.nearestKm).toBeLessThan(300)
    // Крупные тела различимы издалека (замерено 1 365 крупнее 10 px)
    expect(field.largerThanPx(10)).toBeGreaterThan(500)
    // Мелкие тела образуют плотное поле (замерено 24 126 крупнее 1 px)
    expect(field.largerThanPx(1)).toBeGreaterThan(10000)
    // В ближней зоне есть что разглядывать (замерено 6 224 тела ближе 1000 км)
    expect(field.withinKm(1000)).toBeGreaterThan(2000)
    // Пул не молчаливо теряет сектора
    expect(field.poolFailures).toBe(0)
    // Заселены десятки секторов, а не один-два (замерено 293)
    expect(field.activeSectors).toBeGreaterThan(100)

    // Поле — не одна калибра: среди сотни ближайших тел встречаются минимум два
    // из трёх классов размеров каскадов (см. deriveCascades)
    const sizes = field.nearestSizesKm(100)
    const bandsRepresented = new Set(
      sizes.map((size) => cascades.findIndex((c) => size >= c.sizeRangeKm[0] && size <= c.sizeRangeKm[1]))
    )
    expect(bandsRepresented.size).toBeGreaterThan(1)
  })

  it('камера далеко над поясом — поле не заселяется', () => {
    const belt = new AsteroidBelt(beltActorFromDatabase())
    const field = measureBeltField(belt, new Vector3(0, fromAstronomicalUnits(50), 0))

    expect(field.total).toBe(0)
  })
})
