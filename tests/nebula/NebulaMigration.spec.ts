import { describe, it, expect } from 'vitest'
import { Actors, Placements, RenderingObjects } from '@storage/database'
import { nebulaParamsFromData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { INebulaRenderingObject } from '@/core/models/types'

/**
 * Туманность Horuset до миграции жила литералами в RenderableFactory.
 * Тест закрепляет, что перенос в данные не поменял картинку: значения
 * сверяются с теми, что стояли в удалённом хардкоде.
 */
describe('миграция туманности Horuset', () => {
  const actor = Actors.find((a) => a.name === 'Horuset Nebula')
  const rendering = RenderingObjects.find((r) => r.actorId === actor?.id)

  it('актор заведён в системе Horuset с категорией туманности', () => {
    expect(actor).toBeDefined()
    expect(actor!.categoryId).toBe(7)
    // 86 — барицентр системы Horuset
    expect(actor!.parentId).toBe(86)
  })

  it('у актора есть конфиг рендеринга', () => {
    expect(rendering).toBeDefined()
  })

  it('параметры совпадают с прежним хардкодом', () => {
    const params = nebulaParamsFromData(rendering!.data as unknown as INebulaRenderingObject)

    expect(params.size).toBeCloseTo(27000000, 0)
    expect(params.seed).toBe(5120)
    expect(params.shape).toBe('disk')
    expect(params.axisRatios.toArray()).toEqual([1, 0.5, 1])
    expect(params.edgeFalloff).toBeCloseTo(0.6)
    expect(params.density).toBeCloseTo(0.5)
    expect(params.noise.contrast).toBeCloseTo(2)
    expect(params.noise.worleyStrength).toBeCloseTo(0.35)
    expect(params.noise.ridged).toBeCloseTo(1)
    expect(params.cavities).toHaveLength(1)
    expect(params.cavities[0].center.toArray()).toEqual([0.1, 0, 0])
    expect(params.cavities[0].radius).toBeCloseTo(0.4)
    expect(params.cavities[0].strength).toBeCloseTo(0.3)
  })

  it('строки placements не заводится — туманность стоит в центре системы', () => {
    expect(Placements.filter((p) => p.actorId === actor!.id)).toEqual([])
  })
})
