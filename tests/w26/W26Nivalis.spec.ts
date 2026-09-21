import { describe, it, expect } from 'vitest'
import { Actors, PhysicalObjects, Orbits, RenderingObjects } from '@storage/database'
import { Actor } from '@/core/models/Actor'
import { sunAngularRadius } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { resolveLightTint } from '@/core/helpers/lightSource'
import { resolveStarRadiusKm } from '@/core/terrain/starRadius'
import { ATMOSPHERE_CATEGORY_ID, STAR_CATEGORY_ID, GIANT_STAR_CATEGORY_ID } from '@/core/constants'

const actorByCat = (name: string, categoryId: number) => {
  const found = Actors.find((a) => a.name === name && a.categoryId === categoryId)

  expect(found, `актор «${name}» категории ${categoryId} не найден`).toBeDefined()

  return found!
}
const planet = (name: string) => actorByCat(name, 4)
const physical = (name: string) => PhysicalObjects.find((p) => p.actorId === planet(name).id)!
const orbit = (name: string) => Orbits.find((o) => o.actorId === planet(name).id)!
const renderData = (actorId: number) => RenderingObjects.find((r) => r.actorId === actorId)!.data as Record<string, unknown>

const starRadiusKm: number = PhysicalObjects.find((p) => p.actorId === Actors.find((a) => a.name === 'W26')!.id)!.radius

describe('Nivalis — атмосфера (процедурное тело + тонкая оболочка)', () => {
  it('ровно один дочерний актор категории 5; bottomRadius = радиусу тела; topRadius больше; угол сходится с расчётным', () => {
    const nivalis = planet('Nivalis')
    const children = Actors.filter((a) => a.parentId === nivalis.id && a.categoryId === ATMOSPHERE_CATEGORY_ID)

    expect(children).toHaveLength(1)

    const data = renderData(children[0]!.id) as { bottomRadius: number; topRadius: number; sunAngularRadius: number }

    expect(data.bottomRadius).toBe(physical('Nivalis').radius)
    expect(data.topRadius).toBeGreaterThan(data.bottomRadius)

    const expected = sunAngularRadius(starRadiusKm, orbit('Nivalis').semiMajorAxis)
    expect(Math.abs(data.sunAngularRadius - expected) / expected).toBeLessThan(0.01)
  })

  it('пол рельефа конечный и отрицательный, по модулю меньше 1% радиуса; оболочка накрывает пол с запасом', () => {
    const nivalis = planet('Nivalis')
    const atmosphereActor = Actors.find((a) => a.parentId === nivalis.id && a.categoryId === ATMOSPHERE_CATEGORY_ID)!
    const data = renderData(atmosphereActor.id) as {
      bottomRadius: number
      topRadius: number
      terrainFloorMeters: number
    }
    const radiusKm = physical('Nivalis').radius

    expect(Number.isFinite(data.terrainFloorMeters)).toBe(true)
    expect(data.terrainFloorMeters).toBeLessThanOrEqual(0)
    expect(Math.abs(data.terrainFloorMeters)).toBeLessThan(radiusKm * 1000 * 0.01)

    // Пик высот в БД не хранится — метаданных ресурса дешёво не достать в этом
    // тесте, поэтому вместо точной высоты пика сравниваем толщину оболочки
    // с консервативным запасом: вдвое больше глубины пола.
    const thicknessMeters = (data.topRadius - data.bottomRadius) * 1000
    expect(thicknessMeters).toBeGreaterThan(2 * Math.abs(data.terrainFloorMeters))
  })
})

describe('W26 — подписка на цвет света (lightTint)', () => {
  const star = actorByCat('W26', GIANT_STAR_CATEGORY_ID)
  // Ручка приёмки: владелец крутит её в [0, 1], 0 — откат к белому свету.
  // Тесты держат диапазон и обе ветки гейта, а не конкретное значение.
  const lightTint = (renderData(star.id) as { lightTint?: number }).lightTint
  const tintedBodies = [() => planet('Emberon').id, () => actorByCat('Halcyra I', 4).id]

  it('rendering-данные звезды несут lightTint числом в [0, 1]', () => {
    expect(typeof lightTint).toBe('number')
    expect(lightTint!).toBeGreaterThanOrEqual(0)
    expect(lightTint!).toBeLessThanOrEqual(1)
  })

  it.runIf(lightTint! > 0)(
    'подписка > 0: гейт открыт для реальных тел системы (Emberon, Halcyra I), цвет тёплый',
    () => {
      for (const idOf of tintedBodies) {
        const actorId = idOf()
        const tint = resolveLightTint(Actor.find(actorId)!)

        expect(tint.active, `actor ${actorId}`).toBe(true)
        expect(tint.color.b, `actor ${actorId}`).toBeLessThan(tint.color.g)
        expect(tint.color.g, `actor ${actorId}`).toBeLessThan(tint.color.r)
      }
    }
  )

  it.runIf(lightTint === 0)('подписка 0 (откат): гейт закрыт для тел системы, цвет строго белый', () => {
    for (const idOf of tintedBodies) {
      const actorId = idOf()
      const tint = resolveLightTint(Actor.find(actorId)!)

      expect(tint.active, `actor ${actorId}`).toBe(false)
      expect([tint.color.r, tint.color.g, tint.color.b], `actor ${actorId}`).toEqual([1, 1, 1])
    }
  })

  it('resolveLightTint неактивен для реальных тел ДРУГИХ систем (Луна, Коррибан): гейт закрыт, цвет строго белый', () => {
    for (const actorId of [19, 88]) {
      const tint = resolveLightTint(Actor.find(actorId)!)

      expect(tint.active, `actor ${actorId}`).toBe(false)
      expect([tint.color.r, tint.color.g, tint.color.b]).toEqual([1, 1, 1])
    }
  })

  it('resolveStarRadiusKm для реального тела системы возвращает радиус настоящей звезды W26', () => {
    expect(resolveStarRadiusKm(Actor.find(planet('Emberon').id)!)).toBe(1.06e9)
  })

  it('подписка одна: среди звёзд базы (категории 3 и 10) никто кроме W26 не держит lightTint > 0', () => {
    const stars = Actors.filter((a) => a.categoryId === STAR_CATEGORY_ID || a.categoryId === GIANT_STAR_CATEGORY_ID)
    const tinted = stars.filter((a) => {
      const data = RenderingObjects.find((r) => r.actorId === a.id)?.data as { lightTint?: number } | undefined
      return typeof data?.lightTint === 'number' && data.lightTint > 0
    })

    expect(tinted.map((a) => a.name).filter((name) => name !== 'W26')).toEqual([])
  })
})
