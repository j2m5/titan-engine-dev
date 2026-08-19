import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOD, Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { Planet } from '@/core/renderables/Planet'
import type { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import { WaterSphere } from '@/core/renderables/Water/WaterSphere'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import type { ResourceType } from '@/core/models/types'

/** Луна: тело с height-ресурсом и без воды (actorId 19 ↔ resourceId 125, moon_height.raw). */
const MOON_ID: number = 19

/**
 * PlanetMaterial (её держат и Planet, и TerrainSphere) на промахе по ключу
 * текстуры зовёт PlaceholderTexture — она рисует на canvas 2d, которого в
 * jsdom нет («canvas» npm-пакет не установлен). Приём и набор ключей — из
 * `tests/planet/PlanetTerrain.spec.ts`: те же тела (Луна, Земля), тот же
 * список ('', 'default.png', 'night.jpg', diffuse-путь каждого тела).
 */
function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(Actor.find(MOON_ID)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
  seedTexture(Actor.find(7)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

/**
 * Ровная карта: значения одинаковы, поэтому TerrainHeightField выродится в
 * константное поле — быстро строится и не зависит от данных LOLA.
 */
function flatMap(): HeightMapData {
  return { width: 4, height: 2, minMeters: 0, maxMeters: 1000, data: new Uint16Array(8).fill(32768) }
}

function makeFactory(): RenderableFactory {
  const renderer = { domElement: { width: 1920, height: 1080 } }
  const resourceObserver = { textureOf: vi.fn(() => null) }

  return new RenderableFactory(renderer as never, resourceObserver as never)
}

/** Путь ресурса тела по типу — тот же джойн, которым его резолвят материалы. */
function pathOf(actor: Actor, resourceType: ResourceType): string {
  return actor.resources.where('resourceType', resourceType).first()!.getAttribute('path') as string
}

function lodOf(node: DynamicNode): LOD {
  const lod = node.children.find((child): child is LOD => child instanceof LOD)

  if (!lod) throw new Error('LOD не найден в узле')

  return lod
}

let factory: RenderableFactory
let moon: Actor

beforeEach(() => {
  factory = makeFactory()
  moon = Actor.find(MOON_ID)!
  seedPlaceholderKeys()
})

afterEach(() => {
  heightFieldStorage.clear()
  resourceStorage.deleteAllTextures()
  vi.restoreAllMocks()
})

describe('RenderableFactory: подмена нулевого уровня LOD', () => {
  it('апгрейд ставит TerrainSphere вместо Planet и переводит renderable', () => {
    const node = factory.make(moon) as DynamicNode
    const before = lodOf(node).levels[0].object

    expect(before).toBeInstanceOf(Planet)

    heightFieldStorage['maps'].set(heightPathOf(moon)!, flatMap())

    expect(factory.upgradePlanetToTerrain(node)).toBe(true)

    const after = lodOf(node).levels[0].object
    expect(after).toBeInstanceOf(TerrainSphere)
    expect(node.renderable).toBe(after)
    expect(lodOf(node).children).toContain(after)
    expect(lodOf(node).children).not.toContain(before)
  })

  it('апгрейд без карты в реестре ничего не делает', () => {
    const node = factory.make(moon) as DynamicNode

    expect(factory.upgradePlanetToTerrain(node)).toBe(false)
    expect(lodOf(node).levels[0].object).toBeInstanceOf(Planet)
  })

  it('повторный апгрейд идемпотентен', () => {
    const node = factory.make(moon) as DynamicNode
    heightFieldStorage['maps'].set(heightPathOf(moon)!, flatMap())

    factory.upgradePlanetToTerrain(node)

    expect(factory.upgradePlanetToTerrain(node)).toBe(false)
  })

  it('даунгрейд возвращает Planet и убирает рельеф из графа', () => {
    const node = factory.make(moon) as DynamicNode
    heightFieldStorage['maps'].set(heightPathOf(moon)!, flatMap())
    factory.upgradePlanetToTerrain(node)
    const terrain = lodOf(node).levels[0].object

    expect(factory.downgradeTerrainToPlanet(node)).toBe(true)

    const after = lodOf(node).levels[0].object
    expect(after).toBeInstanceOf(Planet)
    expect(node.renderable).toBe(after)
    expect(lodOf(node).children).not.toContain(terrain)
  })

  it('даунгрейд легаси-узла идемпотентен', () => {
    const node = factory.make(moon) as DynamicNode

    expect(factory.downgradeTerrainToPlanet(node)).toBe(false)
  })

  it('дальний уровень LOD апгрейд не трогает', () => {
    const node = factory.make(moon) as DynamicNode
    const far = lodOf(node).levels[1].object
    const farDistance = lodOf(node).levels[1].distance
    heightFieldStorage['maps'].set(heightPathOf(moon)!, flatMap())

    factory.upgradePlanetToTerrain(node)

    expect(lodOf(node).levels.length).toBe(2)
    expect(lodOf(node).levels[1].object).toBe(far)
    expect(lodOf(node).levels[1].distance).toBe(farDistance)
  })

  it('водная оболочка едет вместе с рельефом, если ручка задана', () => {
    // Земля (actorId 7) — единственное тело Solar с waterLevelMeters в БД (0);
    // мокать renderingObject не нужно и опасно: через тот же getAttribute
    // TerrainSphere читает остальные ручки материала
    const earth: Actor = Actor.find(7)!
    const node = factory.make(earth) as DynamicNode
    heightFieldStorage['maps'].set(heightPathOf(earth)!, flatMap())

    factory.upgradePlanetToTerrain(node)

    const terrain = lodOf(node).levels[0].object
    expect(terrain.children.some((child) => child instanceof WaterSphere)).toBe(true)
  })
})

/**
 * Находка №1 финального ревью ветки: конструктор PlanetMaterial текстуры не
 * читает (в юниформах плейсхолдеры default.png/night.jpg), а ResourceObserver
 * зовёт updateMaterial только по своим поводам — свап поверхности ни одним из
 * них не является. Без синхронизации в swapSurface апгрейднутое тело теряло
 * все давно загруженные карты: угловая отсечка стримера (4 px) на порядок
 * мягче порога гейта карт высот (32 px), так что к моменту свапа они уже
 * лежат в resourceStorage и повторно НЕ приедут.
 */
describe('RenderableFactory: свап поверхности подтягивает уже загруженные текстуры', () => {
  it('апгрейд отдаёт рельефу реальный диффуз тела, а не плейсхолдер', () => {
    const node = factory.make(moon) as DynamicNode

    // Легаси-сфера построена на плейсхолдере: реальную карту ей отдаёт
    // ResourceObserver, которого в этом стенде нет — исходное состояние теста
    const legacy = lodOf(node).levels[0].object as Planet
    expect((legacy.material as PlanetMaterial).uniforms.diffuseMap.value.name).toBe('default.png')

    heightFieldStorage['maps'].set(heightPathOf(moon)!, flatMap())
    factory.upgradePlanetToTerrain(node)

    const terrain = lodOf(node).levels[0].object as TerrainSphere
    expect(terrain.material.uniforms.diffuseMap.value.name).toBe(pathOf(moon, 'diffuse'))
  })

  it('даунгрейд отдаёт легаси-сфере реальный диффуз тела, а не плейсхолдер', () => {
    const node = factory.make(moon) as DynamicNode
    heightFieldStorage['maps'].set(heightPathOf(moon)!, flatMap())
    factory.upgradePlanetToTerrain(node)

    factory.downgradeTerrainToPlanet(node)

    const planet = lodOf(node).levels[0].object as Planet
    expect((planet.material as PlanetMaterial).uniforms.diffuseMap.value.name).toBe(pathOf(moon, 'diffuse'))
  })

  it('водная оболочка получает slope-карту прямо на свапе, не ожидая первого кадра', () => {
    const earth: Actor = Actor.find(7)!
    const slopePath: string = pathOf(earth, 'slope')
    seedTexture(slopePath)

    const node = factory.make(earth) as DynamicNode
    heightFieldStorage['maps'].set(heightPathOf(earth)!, flatMap())
    factory.upgradePlanetToTerrain(node)

    const water = lodOf(node).levels[0].object.children.find((child): child is WaterSphere => child instanceof WaterSphere)

    expect(water).toBeDefined()
    expect((water!.material.uniforms.uSlopeMap.value as Texture | null)?.name).toBe(slopePath)
  })
})
