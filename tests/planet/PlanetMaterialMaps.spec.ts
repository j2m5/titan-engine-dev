import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Texture } from 'three'

// Земля (actorId 7) — единственное тело с полным набором карт
function earth(): Actor {
  return Actor.find(7)!
}

function pathOf(kind: ResourceType): string {
  return earth().resources.where('resourceType', kind).first()!.getAttribute('path') as string
}

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/**
 * `getTextureOrMake` при промахе строит PlaceholderTexture, а тот рисует на
 * канвасе — в jsdom `getContext('2d')` возвращает null, и конструктор материала
 * падает. Поэтому сеем все ключи, по которым материал ходит через
 * `getTextureOrMake`: диффуз тела, 'default.png', 'night.jpg' и пустую строку
 * (её подставляет `?? ''` там, где ресурса нет — например текстура колец у
 * Земли).
 */
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(pathOf('diffuse'))
}

describe('PlanetMaterial: привязка карт к юниформам', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('шаг текселя берётся из размеров загруженной карты высот', () => {
    seedTexture(pathOf('bump'), 8192, 4096)

    const material = new PlanetMaterial(earth())
    material.updateMaterial()

    expect(material.uniforms.uBumpTexelSize.value.x).toBeCloseTo(1 / 8192, 10)
    expect(material.uniforms.uBumpTexelSize.value.y).toBeCloseTo(1 / 4096, 10)
    expect(material.defines.USE_BUMP).toBe('1')
  })

  it('без карты высот шаг нулевой — рельеф выключается, а не мусорит', () => {
    const material = new PlanetMaterial(earth())
    material.updateMaterial()

    expect(material.uniforms.uBumpTexelSize.value.x).toBe(0)
    expect(material.uniforms.uBumpTexelSize.value.y).toBe(0)
    expect(material.defines.USE_BUMP).toBeUndefined()
  })

  it('resetMaterial возвращает шаг в ноль', () => {
    seedTexture(pathOf('bump'), 8192, 4096)

    const material = new PlanetMaterial(earth())
    material.updateMaterial()
    material.resetMaterial()

    expect(material.uniforms.uBumpTexelSize.value.x).toBe(0)
    expect(material.uniforms.uBumpTexelSize.value.y).toBe(0)
  })
})
