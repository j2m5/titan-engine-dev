import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import '@/core/framework/TitanThree'
import { Planet } from '@/core/renderables/Planet'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
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

    const node = makeFactory().make(moon()) as unknown as { renderable: unknown }

    expect(node.renderable).toBeInstanceOf(TerrainSphere)
  })

  it('без карты в реестре — легаси Planet', () => {
    const node = makeFactory().make(moon()) as unknown as { renderable: unknown }

    expect(node.renderable).toBeInstanceOf(Planet)
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
    const material = node.renderable.material as PlanetMaterial
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

  // Окно даунгрейда (см. докблок RenderableFactory.swapSurface): сфера на тик
  // несёт USE_TERRAIN_UV, а вершинник под этим дефайном читает patchCenter,
  // которого у SphereGeometry нет. Без дефолта значение приходит из общего
  // generic-слота GL; ноль даёт normalize(position) — радиаль сферы.
  it('материал несёт дефолт атрибута patchCenter — нули', () => {
    const material = new PlanetMaterial(moon())

    expect(material.defaultAttributeValues.patchCenter).toEqual([0, 0, 0])
    // дефолты three (color/uv/uv1) не затёрты
    expect(material.defaultAttributeValues.uv).toEqual([0, 0])
  })
})
