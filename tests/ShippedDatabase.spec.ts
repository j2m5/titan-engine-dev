import { describe, it, expect } from 'vitest'
import {
  Categories,
  Actors,
  Orbits,
  RotationObjects,
  PhysicalObjects,
  RenderingObjects,
  Placements,
  Resources,
  ActorResource
} from '@storage/database'
import { Scenarios } from '@/config/scenarios'
import { validateDatabase, ValidationResult } from '@/core/framework/validation/validateDatabase'

/**
 * Валидатор до сих пор гоняли только по синтетическим снимкам
 * (tests/validateDatabase.spec.ts), то есть поставляемые данные не проверял
 * никто, кроме редактора при ручном открытии. Любая правка сидов — висящий
 * parentId, дубль id, неизвестная категория, сценарий с несуществующим
 * корнем — доезжала до рантайма молча.
 *
 * Предупреждения намеренно НЕ проверяются: у звёзд в базе исторически нет
 * renderingObject, и это осознанная неполнота контента, а не поломка.
 */
function validateShipped(): ValidationResult {
  return validateDatabase(
    {
      categories: Categories,
      actors: Actors,
      orbits: Orbits,
      rotationObjects: RotationObjects,
      physicalObjects: PhysicalObjects,
      renderingObjects: RenderingObjects,
      placements: Placements,
      resources: Resources,
      actorResource: ActorResource
    },
    Scenarios
  )
}

describe('поставляемая база данных', () => {
  it('проходит валидатор без ошибок', () => {
    const result: ValidationResult = validateShipped()

    // Сообщения выводятся целиком: по одному лишь счётчику причину не найти
    expect(result.errors.map((issue) => JSON.stringify(issue))).toEqual([])
  })

  it('каждый сценарий указывает на существующий корень', () => {
    const actorIds = new Set(Actors.map((actor) => actor.id))

    for (const scenario of Scenarios) {
      expect(actorIds.has(scenario.rootId)).toBe(true)

      for (const source of scenario.lightSources) {
        expect(actorIds.has(source)).toBe(true)
      }
    }
  })

  it('идентификаторы акторов не повторяются', () => {
    expect(Actors).toHaveLength(new Set(Actors.map((actor) => actor.id)).size)
  })
})
