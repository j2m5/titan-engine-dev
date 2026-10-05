import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOD, Texture } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { BlackHole } from '@/core/renderables/BlackHole/BlackHole'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { config } from '@/core/framework/config'
import { distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'

/**
 * LOD тел с порогом в экранных пикселях — общий ApparentSizeLod: дистанция
 * переключения пересчитывается каждый кадр по живым fov и высоте вьюпорта.
 * Здесь заперта проводка фабрики: какой класс LOD стоит в узле и с какой
 * стартовой дистанцией.
 */

/** Луна — твёрдое тело без воды */
const MOON_ID: number = 19
/** Sgr A* — дыра с диском */
const SGR_A_ID: number = 43
const VIEWPORT_HEIGHT: number = 1080

function makeFactory(): RenderableFactory {
  const renderer = { domElement: { width: 1920, height: VIEWPORT_HEIGHT } }
  const resourceObserver = { textureOf: vi.fn(() => null), sceneBackground: null }

  return new RenderableFactory(renderer as never, resourceObserver as never, new AtmosphereRegistry(), new DepthVolumeRegistry())
}

function lodOf(node: DynamicNode): LOD {
  const lod = node.children.find((child): child is LOD => child instanceof LOD)

  if (!lod) throw new Error('LOD не найден в узле')

  return lod
}

/**
 * PlanetMaterial на промахе по ключу текстуры зовёт PlaceholderTexture, а та
 * рисует на canvas 2d, которого в jsdom нет — приём из RenderableFactoryUpgrade.spec
 */
function seedPlaceholderKeys(actor: Actor): void {
  const diffuse = actor.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string

  for (const name of ['', 'default.png', 'night.jpg', diffuse]) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

afterEach(() => {
  resourceStorage.deleteAllTextures()
  vi.restoreAllMocks()
})

describe('RenderableFactory: LOD планеты', () => {
  it('общий ApparentSizeLod по диаметру тела с порогом planetImpostor.lodPixels', () => {
    const moon = Actor.find(MOON_ID)!
    seedPlaceholderKeys(moon)
    const lod = lodOf(makeFactory().make(moon) as DynamicNode)
    const radiusKm = moon.physicalObject!.getAttribute('radius')!

    expect(lod).toBeInstanceOf(ApparentSizeLod)
    expect(lod.levels[1].distance).toBeCloseTo(
      distanceForApparentSize(
        toThreeJSUnits(2 * radiusKm),
        config('planetImpostor.lodPixels'),
        config('camera.fov'),
        VIEWPORT_HEIGHT
      ),
      6
    )
  })

  it('фактический порог не сместился: прежние номинальные 3 px по формуле с tan(fov) — те же 3.83 честных', () => {
    // Прежняя формула — исторический эталон точки переключения, не образец:
    // tan(fov) вместо 2·tan(fov/2), высота кадра и fov заморожены на старте
    const moon = Actor.find(MOON_ID)!
    seedPlaceholderKeys(moon)
    const lod = lodOf(makeFactory().make(moon) as DynamicNode)
    const radiusKm = moon.physicalObject!.getAttribute('radius')!
    const legacy = toThreeJSUnits((2 * radiusKm * VIEWPORT_HEIGHT) / (Math.tan(degToRad(config('camera.fov'))) * 3))

    expect(Math.abs(lod.levels[1].distance / legacy - 1)).toBeLessThan(0.01)
  })
})

describe('RenderableFactory: LOD чёрной дыры', () => {
  it('общий ApparentSizeLod по диаметру зоны симуляции с порогом blackHole.lodPixels', () => {
    const node = makeFactory().make(Actor.find(SGR_A_ID)!) as DynamicNode
    const lod = lodOf(node)
    const strong = lod.levels[0].object as BlackHole

    expect(lod).toBeInstanceOf(ApparentSizeLod)
    expect(lod.levels[1].distance).toBeCloseTo(
      distanceForApparentSize(
        toThreeJSUnits(2 * strong.parameters.simulationRadius),
        config('blackHole.lodPixels'),
        config('camera.fov'),
        VIEWPORT_HEIGHT
      ),
      6
    )
    expect(lod.levels[1].hysteresis).toBe(config('blackHole.lodHysteresis'))
  })
})
