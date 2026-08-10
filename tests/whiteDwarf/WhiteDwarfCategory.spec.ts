import { describe, it, expect } from 'vitest'
import { Categories } from '@storage/database'
import { AllowedCategories } from '@/core/models/types'
import { OBSERVED_TYPES } from '@/core/services/SceneObserver'
import { renderingDataTemplates } from '@/ui/editor/forms/dataTemplates'
import { config } from '@/core/framework/config'

describe('категория белого карлика', () => {
  it('заведена в таблице под id 9', () => {
    const category = Categories.find((c) => c.alias === 'whiteDwarf')

    expect(category).toBeDefined()
    expect(category!.id).toBe(9)
  })

  it('объявлена в AllowedCategories', () => {
    expect(Object.keys(AllowedCategories)).toContain('whiteDwarf')
  })

  it('попала в наблюдаемые типы', () => {
    // Тот же список фильтрует навигационный список в UI. Категория, показанная
    // в списке, но неизвестная наблюдателю, даёт мёртвую кнопку «лететь к» —
    // CameraToObjectTransition.handle() молча выходит, не найдя записи
    expect(OBSERVED_TYPES).toContain('whiteDwarf')
  })

  it('имеет заготовку renderingObject.data в редакторе', () => {
    const template = renderingDataTemplates.find((t) => t.value === 'whiteDwarf')

    expect(template).toBeDefined()
    // Ручка ровно одна: всё остальное выводится из температуры физического
    // объекта, и дублировать это в data значило бы разрешить им разойтись
    expect(Object.keys(template!.data as object)).toEqual(['exposureBias'])
  })
})

describe('конфиг белого карлика', () => {
  it('гистерезис LOD тот же, что у звезды и коричневого карлика', () => {
    expect(config('whiteDwarf.lodHysteresis')).toBe(0.05)
  })

  it('ореол ярче звёздного, но туже', () => {
    // Тело почти всегда мельче пикселя — весь вид объекта несёт ореол. При
    // этом он обязан читаться жёсткой искрой: короны у карлика нет физически
    expect(config('whiteDwarf.haloOpacity')).toBeGreaterThan(0.03)
    expect(config('whiteDwarf.haloScale')).toBeLessThan(0.8)
  })

  it('дефолты соседних типов не сдвинуты', () => {
    expect(config('star.lodHysteresis')).toBe(0.05)
    expect(config('brownDwarf.haloOpacity')).toBe(0.015)
  })
})
