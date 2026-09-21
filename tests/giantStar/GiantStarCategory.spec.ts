import { describe, it, expect } from 'vitest'
import { Categories } from '@storage/database'
import { AllowedCategories } from '@/core/models/types'
import { OBSERVED_TYPES } from '@/core/services/SceneObserver'
import { renderingDataTemplates } from '@/ui/editor/forms/dataTemplates'
import { config } from '@/core/framework/config'
import { GIANT_STAR_IMPOSTOR_PIXELS, STAR_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'

describe('категория звезды-гиганта', () => {
  it('заведена в таблице под id 10', () => {
    const category = Categories.find((c) => c.alias === 'giantStar')

    expect(category).toBeDefined()
    expect(category!.id).toBe(10)
  })

  it('объявлена в AllowedCategories', () => {
    expect(Object.keys(AllowedCategories)).toContain('giantStar')
  })

  it('попала в наблюдаемые типы', () => {
    // Без записи здесь кнопка «лететь к» мертва
    expect(OBSERVED_TYPES).toContain('giantStar')
  })

  it('имеет заготовку renderingObject.data в редакторе', () => {
    const template = renderingDataTemplates.find((t) => t.value === 'giantStar')

    expect(template).toBeDefined()
    // Цвета, яркости и лимба здесь нет намеренно: они выводятся из температуры
    expect(Object.keys(template!.data as object)).toEqual([
      'seed',
      'cellCount',
      'cellContrast',
      'atmosphereHeight',
      'atmosphereDensity',
      'exposureBias',
      'lightTint'
    ])
  })

  it('импостор не мельче звёздного', () => {
    expect(GIANT_STAR_IMPOSTOR_PIXELS).toBe(STAR_IMPOSTOR_PIXELS)
  })
})

describe('конфиг звезды-гиганта', () => {
  it('гистерезис LOD общий со звездой', () => {
    expect(config('giantStar.lodHysteresis')).toBe(0.05)
  })

  it('пороги прокси-экспозиции упорядочены', () => {
    expect(config('giantStar.proximityExposureStart')).toBeLessThan(config('giantStar.proximityExposureEnd'))
    expect(config('giantStar.proximityExposureFloor')).toBeGreaterThan(0)
    expect(config('giantStar.proximityExposureFloor')).toBeLessThanOrEqual(1)
  })

  it('дефолты соседних типов не сдвинуты', () => {
    expect(config('star.lodHysteresis')).toBe(0.05)
    expect(config('whiteDwarf.haloOpacity')).toBe(0.05)
  })
})
