import { Mesh, Texture } from 'three'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

// Луна (actorId 19) — тело с height-ресурсом
function moon(): Actor {
  return Actor.find(19)!
}

function makeField(): TerrainHeightField {
  const map: HeightMapData = {
    width: 8,
    height: 4,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(32).fill(30000)
  }
  return new TerrainHeightField(map, 1737.4)
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// PlanetMaterial в конструкторе ходит за плейсхолдерами (см. PlanetMaterialMaps.spec)
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

describe('TerrainSphere: кубосфера из патчей', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('строит 384 патча-меша с общим материалом и общим индексом', () => {
    const sphere = new TerrainSphere(moon(), makeField())
    const patches = sphere.children.filter((child): child is Mesh => child instanceof Mesh)

    expect(patches).toHaveLength(384)
    for (const patch of patches) {
      expect(patch.material).toBe(sphere.material)
      expect(patch.geometry.getIndex()).toBe(patches[0].geometry.getIndex())
      expect(patch.frustumCulled).toBe(true)
      expect(patch.userData.clickable).toBe(true)
    }
  })

  it('контракты снапшота и стриминга: model/type/clickable на группе, .material — PlanetMaterial', () => {
    // Actor.find создаёт новый инстанс на каждый вызов (Model.find не мемоизирует) —
    // сравнение по ссылке требует одного захваченного вызова, а не двух moon()
    const actor = moon()
    const sphere = new TerrainSphere(actor, makeField())

    expect(sphere.model).toBe(actor)
    expect(sphere.userData.type).toBe('planet')
    expect(sphere.userData.clickable).toBe(true)
    expect(sphere.material.constructor.name).toBe('PlanetMaterial')
  })

  it('патчи стоят на своих RTC-центрах: |позиция патча| ≈ радиус поверхности', () => {
    const field = makeField()
    const sphere = new TerrainSphere(moon(), field)
    const patch = sphere.children[0] as Mesh

    const radius = patch.position.length()
    // константная карта +458 м (raw 30000 из 0..1000): все центры на одном радиусе
    expect(radius).toBeCloseTo(field.surfaceRadiusUnits(patch.position.clone().normalize()), 10)
  })
})
