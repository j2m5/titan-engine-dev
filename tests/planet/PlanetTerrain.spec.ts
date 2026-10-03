import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import '@/core/framework/TitanThree'
import { Planet } from '@/core/renderables/Planet'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { heightPathOf } from '@/core/terrain/heightPath'
import {
  resetRegistries,
  seedFull,
  seedHeightMap as seedBodyHeightMap,
  seedPlaceholderKeys as seedBodyPlaceholderKeys
} from '../fixtures/planetMaterialParity/collectStates'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import { proceduralDiffuseKey, type ProceduralSurfaceGenerator } from '@/core/services/ProceduralSurfaceGenerator'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { IPlanetRenderingObject } from '@/core/models/types'
import type { WebGLRenderer } from 'three'

const MOON_ID = 19
const MOON_HEIGHT_PATH = 'planets/moon/moon_height.raw'

function moon(): Actor {
  return Actor.find(MOON_ID)!
}

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

// фабрике нужны только domElement.height (порог LOD) и наблюдатель (не дёргается в createPlanet)
function makeFactory(): RenderableFactory {
  return new RenderableFactory(
    { domElement: { height: 1080 } } as unknown as WebGLRenderer,
    {} as unknown as ResourceObserver,
    new AtmosphereRegistry(),
    new DepthVolumeRegistry()
  )
}

beforeEach(() => seedPlaceholderKeys())

afterEach(() => {
  resourceStorage.deleteAllTextures()
  heightFieldStorage.clear()
})

describe('RenderableFactory: ветка рельефа', () => {
  it('с картой в реестре нулевой уровень LOD — TerrainSphere', { timeout: 30000 }, () => {
    seedHeightMap()

    const node = makeFactory().make(moon()) as unknown as { renderable: TerrainSphere }

    expect(node.renderable).toBeInstanceOf(TerrainSphere)
    expect(node.renderable.material).toBeInstanceOf(TerrainMaterial)
  })

  it('без карты в реестре — легаси Planet', () => {
    const node = makeFactory().make(moon()) as unknown as { renderable: Planet }

    expect(node.renderable).toBeInstanceOf(Planet)
    expect(node.renderable.material).toBeInstanceOf(SphereSurfaceMaterial)
  })

  it('процедурное тело без карты: легаси Planet получает процедурный диффуз, а не плейсхолдер', () => {
    let actor: Actor | undefined
    for (let id = 1; id < 1000 && !actor; id++) {
      const candidate = Actor.find(id)
      if (candidate && readRenderingData<IPlanetRenderingObject>(candidate)?.proceduralSurface) actor = candidate
    }
    expect(actor).toBeDefined()
    const key = proceduralDiffuseKey(actor!.getAttribute('id', -1) as number)
    // генератор рендерит на GPU — здесь только регистрирует текстуру под ключом, как настоящий
    const ensureDiffuse = vi.fn((): string => (seedTexture(key), key))
    const factory = new RenderableFactory(
      { domElement: { height: 1080 } } as unknown as WebGLRenderer,
      {} as unknown as ResourceObserver,
      new AtmosphereRegistry(),
      new DepthVolumeRegistry(),
      { ensureDiffuse } as unknown as ProceduralSurfaceGenerator
    )

    const node = factory.make(actor!) as unknown as { renderable: Planet }

    expect(node.renderable).toBeInstanceOf(Planet)
    expect(ensureDiffuse).toHaveBeenCalledWith(actor)
    const material = node.renderable.material as SphereSurfaceMaterial
    material.updateMaterial()
    expect(material.uniforms.diffuseMap.value.name).toBe(key)
  })

  it('тело без height-ресурса (Земля) — легаси Planet всегда', () => {
    seedHeightMap()

    const node = makeFactory().make(Actor.find(7)!) as unknown as { renderable: unknown }

    expect(node.renderable).toBeInstanceOf(Planet)
  })
})

describe('Planet: легаси-сфера', () => {
  it('всегда 256×256 c circumscribe — ветки рельефа больше нет', () => {
    seedHeightMap()

    const planet = new Planet(moon())
    const parameters = (planet.geometry as unknown as { parameters: { widthSegments: number } }).parameters

    expect(parameters.widthSegments).toBe(256)
  })

  // Вершинник сферы patchCenter не читает (атрибуты патча — только у рельефа),
  // поэтому и дефолтов атрибутов патча у материала сферы нет
  it('у SphereSurfaceMaterial нет атрибутов патча в defaultAttributeValues', () => {
    seedHeightMap()

    const material = new Planet(moon()).material as SphereSurfaceMaterial

    expect(material).toBeInstanceOf(SphereSurfaceMaterial)
    expect(material.defaultAttributeValues).not.toHaveProperty('patchCenter')
    expect(material.vertexShader).not.toContain('patchCenter')
    // дефолты three (color/uv/uv1) не затёрты
    expect(material.defaultAttributeValues.uv).toEqual([0, 0])
  })
})

describe('материалы путей', () => {
  // Дефайны, которые знает только шаблон рельефа (USE_TERRAIN_UV — снятый путевой дефайн)
  const TERRAIN_DEFINES = [
    'USE_TERRAIN_UV',
    'USE_SLOPE',
    'USE_CAVITY',
    'USE_TERRAIN_DETAIL',
    'USE_TERRAIN_MACRO_DETAIL',
    'USE_WATER_EDGE',
    'USE_CLOUD_SHADOW',
    'USE_TERRAIN_SHADOW',
    'USE_TERRAIN_GLINT',
    'USE_TERRAIN_FROST'
  ]
  const PATCH_ATTRIBUTES = ['patchCenter', 'midShade', 'morphDelta', 'patchMorph', 'midShadeParent', 'midTiltParent']

  const terrainBodies = (): Actor[] =>
    Actor.where({ categoryId: 4 })
      .all()
      .filter((a) => heightPathOf(a) !== undefined)

  /** Тело со всеми картами (и картой высот в реестре, если она у тела есть) — как в окне даунгрейда. */
  const seedBody = (actor: Actor): void => {
    resetRegistries()
    seedBodyPlaceholderKeys(actor)
    const heightPath = heightPathOf(actor)
    if (heightPath !== undefined) seedBodyHeightMap(heightPath)
    seedFull(actor, true)
  }

  // '' нужна только конструктору (кольца через `?? ''`); в рантайме под '' ничего нет,
  // иначе тело без ночной/облачной/specular-строки нашло бы фантомную карту
  const dropEmptyKey = (): void => {
    resourceStorage.deleteTexture('')
  }

  it('Planet строит материал сферы, TerrainSphere — материал рельефа', () => {
    const planet = new Planet(moon())
    expect(planet.material).toBeInstanceOf(SphereSurfaceMaterial)
    expect(planet.material).not.toBeInstanceOf(TerrainMaterial)
  })

  // Окно даунгрейда (см. докблок RenderableFactory.swapSurface): сфера на тик
  // видит карту высот в реестре; рельефных дефайнов ей не положено вовсе
  it('окно даунгрейда: сфера при карте высот в реестре не ставит ни одного дефайна рельефа', () => {
    expect(terrainBodies().length).toBeGreaterThan(0)
    for (const actor of terrainBodies()) {
      const id = actor.getAttribute('id')
      seedBody(actor)
      // контроль посева: материал рельефа на том же реестре дефайны рельефа ставит
      const terrain = new TerrainMaterial(actor)
      const sphere = new SphereSurfaceMaterial(actor)
      dropEmptyKey()
      terrain.updateMaterial()
      expect(Object.keys(terrain.defines).filter((d) => TERRAIN_DEFINES.includes(d)), `${id} рельеф`).not.toEqual([])
      terrain.dispose()

      sphere.updateMaterial()
      expect(Object.keys(sphere.defines).filter((d) => TERRAIN_DEFINES.includes(d)), `${id}`).toEqual([])
      for (const name of PATCH_ATTRIBUTES) expect(sphere.defaultAttributeValues, `${id} ${name}`).not.toHaveProperty(name)
      sphere.dispose()
    }
    resetRegistries()
  })

  it('дефолты атрибутов патча — только у материала рельефа; дефолты three не затёрты', () => {
    seedBody(moon())
    const terrain = new TerrainMaterial(moon())
    expect(terrain.defaultAttributeValues.patchCenter).toEqual([0, 0, 0])
    expect(terrain.defaultAttributeValues.morphDelta).toEqual([0, 0, 0])
    expect(terrain.defaultAttributeValues.uv).toEqual([0, 0])
    const sphere = new SphereSurfaceMaterial(moon())
    expect(sphere.defaultAttributeValues).toEqual({ color: [1, 1, 1], uv: [0, 0], uv1: [0, 0] })
    resetRegistries()
  })

  it('resetMaterial возвращает дефайны к снимку конструирования и поднимает needsUpdate', () => {
    // сфера — Земля (ночь, облака, specular), рельеф — Луна (slope, деталь, тень)
    const cases: [string, () => SphereSurfaceMaterial | TerrainMaterial, Actor][] = [
      ['сфера', () => new SphereSurfaceMaterial(Actor.find(7)!), Actor.find(7)!],
      ['рельеф', () => new TerrainMaterial(moon()), moon()]
    ]
    for (const [name, make, actor] of cases) {
      seedBody(actor)
      const material = make()
      dropEmptyKey()
      const base = { ...material.defines }
      material.updateMaterial()
      // контроль: карты открыли дефайны сверх снимка
      expect(material.defines, name).not.toStrictEqual(base)
      const version = material.version
      material.resetMaterial()
      expect(material.defines, name).toStrictEqual(base)
      expect(material.version, name).toBeGreaterThan(version)
      material.dispose()
    }
    resetRegistries()
  })
})
