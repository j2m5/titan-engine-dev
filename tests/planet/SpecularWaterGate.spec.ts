import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Texture } from 'three'

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

const DIFFUSE_PATH = 'stub/specular-gate/diffuse.png'
const SPECULAR_PATH = 'stub/specular-gate/specular.jpg'

function stubActor(data: Record<string, unknown>): Actor {
  const pathByType: Record<string, string> = { diffuse: DIFFUSE_PATH, specular: SPECULAR_PATH }

  return {
    renderingObject: { getAttribute: () => ({ bumpScale: 1, emission: 1, ...data }) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: (_field: string, type: string) => ({
        first: () => (pathByType[type] ? { getAttribute: () => pathByType[type] } : undefined)
      })
    },
    getAttribute: () => 'StubBody'
  } as unknown as Actor
}

/**
 * Specular-карта суши — маска «океан/суша» легаси-вида, блик солнца на воде
 * тогда рисовала сама планета. У тел с водной оболочкой (waterLevelMeters)
 * блик принадлежит WaterSphere; HDR-блик суши под полупрозрачной водой
 * (uWaterAlphaDeep 0.85 → 15 % дна видно) просачивался вторым, белым бликом
 * поверх голубого водного.
 */
describe('PlanetMaterial: USE_SPECULAR гасится у тел с водной оболочкой', () => {
  beforeEach(() => {
    seedTexture('')
    seedTexture('default.png')
    seedTexture('night.jpg')
    seedTexture(DIFFUSE_PATH)
    seedTexture(SPECULAR_PATH)
  })
  afterEach(() => resourceStorage.deleteAllTextures())

  it('без воды specular-карта включает блик', () => {
    const material = new PlanetMaterial(stubActor({}))
    material.updateMaterial()

    expect(material.defines.USE_SPECULAR).toBe('1')
  })

  it('с waterLevelMeters блик суши выключен — им владеет вода', () => {
    const material = new PlanetMaterial(stubActor({ waterLevelMeters: 0 }))
    material.updateMaterial()

    expect(material.defines.USE_SPECULAR).toBeUndefined()
  })

  it('Земля (actorId 7): водная оболочка есть, specular-ресурс есть — дефайн молчит', () => {
    const earth = Actor.find(7)!
    const specularPath = earth.resources.where('resourceType', 'specular').first()!.getAttribute('path') as string
    const diffusePath = earth.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string
    seedTexture(specularPath)
    seedTexture(diffusePath)

    const material = new PlanetMaterial(earth)
    material.updateMaterial()

    expect(material.defines.USE_SPECULAR).toBeUndefined()
  })
})
