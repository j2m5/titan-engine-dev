import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { Planet } from '@/core/renderables/Planet'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const MOON_ID = 19
const MOON_HEIGHT_PATH = 'planets/moon/moon_height.raw'

function moon(): Actor {
  return Actor.find(MOON_ID)!
}

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

function seedHeightMap(): void {
  // 4×2, все значения максимальны, диапазон 0..1000 м → вся сфера на +1 км
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(MOON_HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array([65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535])
  })
}

beforeEach(() => seedPlaceholderKeys())

afterEach(() => {
  resourceStorage.deleteAllTextures()
  heightFieldStorage.clear()
})

describe('Planet: ветка рельефа', () => {
  // Таймаут выше дефолтных 5с: тест строит честную сферу на TERRAIN_SPHERE_SEGMENTS
  // (~1 млн вершин × 5 выборок карты) — на нагруженной параллельным прогоном
  // машине укладывается не всегда, и это не сигнал регрессии
  it('с картой в реестре строит смещённую сферу', { timeout: 30000 }, () => {
    seedHeightMap()

    const planet = new Planet(moon())
    const radius = toThreeJSUnits(moon().physicalObject!.getAttribute('radius')!)
    const positions = planet.geometry.getAttribute('position')
    const first = new Vector3(positions.getX(0), positions.getY(0), positions.getZ(0))

    // все вершины на R + 1 км — конструктор прочитал реестр синхронно
    expect(first.length()).toBeCloseTo(radius + toThreeJSUnits(1), 6)
  })

  it('без карты в реестре геометрия легаси: 256×256 с circumscribe', () => {
    const planet = new Planet(moon())
    const parameters = (planet.geometry as unknown as { parameters: { widthSegments: number; radius: number } })
      .parameters
    const radius = toThreeJSUnits(moon().physicalObject!.getAttribute('radius')!)

    expect(parameters.widthSegments).toBe(256)
    expect(parameters.radius).toBeGreaterThan(radius) // circumscribe > 1
  })

  it('у тела без height-ресурса (Земля, actorId 7) ветка рельефа не активируется', () => {
    seedTexture(Actor.find(7)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)

    const planet = new Planet(Actor.find(7)!)
    const parameters = (planet.geometry as unknown as { parameters: { widthSegments: number } }).parameters

    expect(parameters.widthSegments).toBe(256)
  })
})

describe('PlanetMaterial: подавление bump при height-ресурсе', () => {
  it('у Луны USE_BUMP не включается даже с посеянной bump-текстурой', () => {
    seedTexture(moon().resources.where('resourceType', 'bump').first()!.getAttribute('path') as string, 8192, 4096)

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.defines.USE_BUMP).toBeUndefined()
    expect(material.uniforms.uBumpTexelSize.value.x).toBe(0)
  })

  it('у Земли (без height-ресурса) bump работает как раньше', () => {
    const earth = Actor.find(7)!
    seedTexture(earth.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
    seedTexture(earth.resources.where('resourceType', 'bump').first()!.getAttribute('path') as string, 8192, 4096)

    const material = new PlanetMaterial(earth)
    material.updateMaterial()

    expect(material.defines.USE_BUMP).toBe('1')
  })
})
