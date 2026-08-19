import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture, Vector3 } from 'three'
import { cloudOpacityForAltitude, PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'

// Земля (actorId 7, атмосфера actorId 47: bottomRadius=6360, topRadius=6420,
// H=60 км) — то же реальное тело, что PlanetMaterialMaps.spec.ts.
function earth(): Actor {
  return Actor.find(7)!
}

const frag: string = PlanetShaderTemplate.fragmentShader

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

/**
 * `getTextureOrMake` при промахе строит PlaceholderTexture (canvas 2d,
 * недоступен в jsdom) — тот же приём, что PlanetMaterialMaps.spec.ts
 * seedPlaceholderKeys. Тесты этого файла конструктор материала не идут
 * дальше конструктора (updateMaterial() не зовут — за него отвечают другие
 * файлы), поэтому по фактическому стеку падения нужны только конструкторные
 * ключи: 'default.png'/'night.jpg' (PlanetShader), '' (ringMap-заглушка).
 */
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
}

/**
 * Стаб-актор без атмосферы (categoryId=5 среди children отсутствует) — та же
 * форма стаба, что legacyBumpActor в PlanetMaterialMaps.spec.ts. `radiusKm`
 * опционален (стабы без него — существующий паттерн WaterShader.spec.ts).
 */
function actorWithoutAtmosphere(radiusKm?: number): Actor {
  return {
    renderingObject: { getAttribute: () => ({ bumpScale: 0, emission: 1 }) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: { where: () => ({ first: () => undefined }) },
    ...(radiusKm !== undefined && { physicalObject: { getAttribute: () => radiusKm } })
  } as unknown as Actor
}

describe('PlanetShaderTemplate: uCloudOpacity — высотный fade облаков (приёмочная волна 4, №3)', () => {
  it('юниформ uCloudOpacity объявлен и домножает cloudColor/cloudAlpha ВНУТРИ USE_CLOUD', () => {
    expect(frag).toContain('uniform float uCloudOpacity;')

    const cloudBlockStart = frag.indexOf('#ifdef USE_CLOUD')
    const cloudBlockEnd = frag.indexOf('#endif', cloudBlockStart)
    const block = frag.slice(cloudBlockStart, cloudBlockEnd)

    expect(block).toContain('cloudColor *= uCloudOpacity;')
    expect(block).toContain('cloudAlpha *= uCloudOpacity;')
  })
})

describe('cloudOpacityForAltitude: чистая формула (границы + линейность)', () => {
  it('alt >= H → 1.0 (из космоса, вся толщина атмосферы над камерой)', () => {
    expect(cloudOpacityForAltitude(100, 100)).toBe(1)
    expect(cloudOpacityForAltitude(250, 100)).toBe(1) // выше H — клампится, не растёт дальше
  })

  it('alt === 0.5*H → 0 (середина толщины — порог погасания)', () => {
    expect(cloudOpacityForAltitude(50, 100)).toBe(0)
  })

  it('alt < 0.5*H → 0 (клампится снизу, не уходит в отрицательные значения)', () => {
    expect(cloudOpacityForAltitude(0, 100)).toBe(0)
    expect(cloudOpacityForAltitude(-50, 100)).toBe(0)
  })

  it('между 0.5*H и H — линейно', () => {
    const H = 100

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const alt = 0.5 * H + t * (0.5 * H) // от 0.5H до H

      expect(cloudOpacityForAltitude(alt, H)).toBeCloseTo(t, 12)
    }
  })

  it('юнит-независима: alt/H в километрах и в юнитах сцены дают тот же результат (масштаб сокращается)', () => {
    const altKm = 45
    const hKm = 100
    const scale = 0.0037 // произвольный масштаб (условные "юниты сцены")

    expect(cloudOpacityForAltitude(altKm * scale, hKm * scale)).toBeCloseTo(cloudOpacityForAltitude(altKm, hKm), 12)
  })
})

describe('PlanetMaterial.updateCloudOpacity: резолв толщины атмосферы по дочернему актору (разовый, конструктор)', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('тело БЕЗ атмосферы (нет actor.children с categoryId=5) — uCloudOpacity держится константой 1 независимо от позиции камеры', () => {
    const material = new PlanetMaterial(actorWithoutAtmosphere(1000))

    material.updateCloudOpacity(new Vector3(0, 0, 0), new Vector3(0, 0, 0)) // altitude = -radius, вплотную к телу
    expect(material.uniforms.uCloudOpacity.value).toBe(1)

    material.updateCloudOpacity(new Vector3(1e9, 0, 0), new Vector3(0, 0, 0)) // очень далеко
    expect(material.uniforms.uCloudOpacity.value).toBe(1)
  })

  it('Земля (реальные данные БД: bottomRadius=6360, topRadius=6420, H=60 км) — opacity падает по мере снижения камеры к поверхности', () => {
    const material = new PlanetMaterial(earth())
    const bodyRadiusUnits = toThreeJSUnits(6360)
    const hUnits = toThreeJSUnits(60)
    const modelWorld = new Vector3(0, 0, 0)

    const cameraAt = (altitudeUnits: number): Vector3 => new Vector3(bodyRadiusUnits + altitudeUnits, 0, 0)

    material.updateCloudOpacity(cameraAt(hUnits), modelWorld) // на границе атмосферы — видно целиком
    expect(material.uniforms.uCloudOpacity.value).toBeCloseTo(1, 10)

    material.updateCloudOpacity(cameraAt(0.5 * hUnits), modelWorld) // середина толщины — погасло
    expect(material.uniforms.uCloudOpacity.value).toBeCloseTo(0, 10)

    material.updateCloudOpacity(cameraAt(0.75 * hUnits), modelWorld) // между — линейная точка (t=0.5)
    expect(material.uniforms.uCloudOpacity.value).toBeCloseTo(0.5, 10)

    material.updateCloudOpacity(cameraAt(bodyRadiusUnits * 5), modelWorld) // далеко в космосе
    expect(material.uniforms.uCloudOpacity.value).toBeCloseTo(1, 10)
  })
})
