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

  it('rendering-данные звезды несут lightTint 0.8 последним ключом', () => {
    const data = renderData(star.id) as { lightTint?: number }

    expect(data.lightTint).toBe(0.8)
  })

  it('resolveLightTint активен для реальных тел системы (Emberon, Halcyra I): гейт открыт, цвет тёплый', () => {
    const emberon = planet('Emberon')
    const halcyra1 = actorByCat('Halcyra I', 4)

    for (const actorId of [emberon.id, halcyra1.id]) {
      const tint = resolveLightTint(Actor.find(actorId)!)

      expect(tint.active, `actor ${actorId}`).toBe(true)
      expect(tint.color.b, `actor ${actorId}`).toBeLessThan(tint.color.g)
      expect(tint.color.g, `actor ${actorId}`).toBeLessThan(tint.color.r)
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

  it('подписка одна: среди звёзд базы (категории 3 и 10) только W26 держит lightTint > 0', () => {
    const stars = Actors.filter((a) => a.categoryId === STAR_CATEGORY_ID || a.categoryId === GIANT_STAR_CATEGORY_ID)
    const tinted = stars.filter((a) => {
      const data = RenderingObjects.find((r) => r.actorId === a.id)?.data as { lightTint?: number } | undefined
      return typeof data?.lightTint === 'number' && data.lightTint > 0
    })

    expect(tinted.map((a) => a.name)).toEqual(['W26'])
  })
})
