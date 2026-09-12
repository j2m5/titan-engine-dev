import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOD, Object3D, Texture } from 'three'
import '@/core/framework/TitanThree'
import { Planet } from '@/core/renderables/Planet'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { SyncTerrainPatchBuilder, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { FakeAsyncBuilder } from '../terrain/fakeAsyncBuilder'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import type { WebGLRenderer } from 'three'

const MOON_ID = 19
const MOON_HEIGHT_PATH = 'planets/moon/moon_height.raw'
// 6 граней × 2×2 патча уровня TERRAIN_QUADTREE_MIN_LEVEL
const INITIAL_PATCHES = 24

function moon(): Actor {
  return Actor.find(MOON_ID)!
}

// Набор ключей — как в PlanetTerrain.spec: PlanetMaterial на промахе идёт в
// PlaceholderTexture, а canvas 2d в jsdom нет
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
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
  seedTexture(Actor.find(7)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

function seedHeightMap(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(MOON_HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array([65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535])
  })
}

function makeFactory(builder: TerrainPatchBuilder, refreshObservation?: () => void): RenderableFactory {
  return new RenderableFactory(
    { domElement: { height: 1080 } } as unknown as WebGLRenderer,
    {} as unknown as ResourceObserver,
    new AtmosphereRegistry(),
    new DepthVolumeRegistry(),
    undefined,
    builder,
    refreshObservation
  )
}

function lodLevel0(node: DynamicNode): Object3D {
  const lod = node.children.find((child): child is LOD => child instanceof LOD)!

  return lod.levels[0].object
}

describe('RenderableFactory: свап поверхности по готовности начального набора', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
  })

  afterEach(() => {
    heightFieldStorage.clear()
    resourceStorage.deleteAllTextures()
  })

  it('асинхронный строитель: до 24 приходов легаси-сфера на месте, апгрейд идемпотентен; после — TerrainSphere', () => {
    const builder = new FakeAsyncBuilder()
    const factory = makeFactory(builder)
    const node = factory.make(moon()) as DynamicNode

    expect(lodLevel0(node)).toBeInstanceOf(Planet)

    seedHeightMap()

    expect(factory.upgradePlanetToTerrain(node)).toBe(false)
    expect(lodLevel0(node)).toBeInstanceOf(Planet)
    expect(factory.hasPendingUpgrade(node)).toBe(true)
    expect(builder.queued).toBe(INITIAL_PATCHES)

    expect(factory.upgradePlanetToTerrain(node)).toBe(false)
    expect(builder.queued).toBe(INITIAL_PATCHES)

    builder.flush(INITIAL_PATCHES - 1)

    expect(lodLevel0(node)).toBeInstanceOf(Planet)

    builder.flush(1)

    expect(lodLevel0(node)).toBeInstanceOf(TerrainSphere)
    expect(factory.hasPendingUpgrade(node)).toBe(false)
    expect(factory.upgradePlanetToTerrain(node)).toBe(false)
  })

  it('даунгрейд до готовности отменяет апгрейд: сфера диспознута, слоты и поле отпущены, легаси на месте', () => {
    const builder = new FakeAsyncBuilder()
    const factory = makeFactory(builder)
    const node = factory.make(moon()) as DynamicNode

    seedHeightMap()
    factory.upgradePlanetToTerrain(node)

    expect(factory.downgradeTerrainToPlanet(node)).toBe(false)
    expect(factory.hasPendingUpgrade(node)).toBe(false)
    expect(builder.released).toHaveLength(1)
    expect(() => builder.flush()).not.toThrow()
    expect(lodLevel0(node)).toBeInstanceOf(Planet)
  })

  it('синхронный строитель: свап сразу, как прежде', () => {
    const factory = makeFactory(new SyncTerrainPatchBuilder())
    const node = factory.make(moon()) as DynamicNode

    seedHeightMap()

    expect(factory.upgradePlanetToTerrain(node)).toBe(true)
    expect(lodLevel0(node)).toBeInstanceOf(TerrainSphere)
  })

  it('свап по готовности пересобирает снимок наблюдения — вне тика гейта это делать некому', () => {
    const builder = new FakeAsyncBuilder()
    let refreshes = 0
    const factory = new RenderableFactory(
      { domElement: { height: 1080 } } as unknown as WebGLRenderer,
      {} as unknown as ResourceObserver,
      new AtmosphereRegistry(),
      new DepthVolumeRegistry(),
      undefined,
      builder,
      () => refreshes++
    )
    const node = factory.make(moon()) as DynamicNode

    seedHeightMap()
    factory.upgradePlanetToTerrain(node)

    expect(refreshes).toBe(0)

    builder.flush()

    expect(refreshes).toBe(1)
  })

  it('clearPendingUpgrades: отсоединённая сфера разобрана, поле отпущено, поздний flush ничего не свапает', () => {
    const builder = new FakeAsyncBuilder()
    const factory = makeFactory(builder)
    const node = factory.make(moon()) as DynamicNode

    seedHeightMap()
    factory.upgradePlanetToTerrain(node)
    factory.clearPendingUpgrades()

    expect(factory.hasPendingUpgrade(node)).toBe(false)
    expect(builder.released).toHaveLength(1)

    builder.flush()

    expect(lodLevel0(node)).toBeInstanceOf(Planet)
  })

  it('поздняя готовность после выгрузки карты: свапа нет, сфера разобрана, снимок не пересобирается', () => {
    const builder = new FakeAsyncBuilder()
    const refresh = vi.fn()
    const factory = makeFactory(builder, refresh)
    const node = factory.make(moon()) as DynamicNode

    seedHeightMap()
    factory.upgradePlanetToTerrain(node)
    // карта ушла, даунгрейд гейтом не дошёл
    heightFieldStorage.clear()
    builder.flush()

    expect(lodLevel0(node)).toBeInstanceOf(Planet)
    expect(factory.hasPendingUpgrade(node)).toBe(false)
    expect(builder.released).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('поздняя готовность после замены нулевого уровня: свапа нет, сфера разобрана', () => {
    const builder = new FakeAsyncBuilder()
    const refresh = vi.fn()
    const factory = makeFactory(builder, refresh)
    const node = factory.make(moon()) as DynamicNode
    const lod = node.children.find((child): child is LOD => child instanceof LOD)!
    const replacement = new Object3D()

    seedHeightMap()
    factory.upgradePlanetToTerrain(node)
    lod.levels[0].object = replacement
    builder.flush()

    expect(lodLevel0(node)).toBe(replacement)
    expect(factory.hasPendingUpgrade(node)).toBe(false)
    expect(builder.released).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
  })
})
