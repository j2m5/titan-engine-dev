import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { resolveTerrainLightParams } from '@/core/terrain/terrainLightParams'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { sunTransmittanceFunctions } from '@/core/materials/shaders/lib/chunks/SunTransmittance'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'

function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

function stubActor(data: Record<string, unknown>): Actor {
  return {
    renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 1, ...data }) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: { where: () => ({ first: () => undefined }) }
  } as unknown as Actor
}

describe('ручки облаков: cloudHeightKm и cloudLightSoftness', () => {
  it('дефолты 6 км и 0.1; старого поля cloudShadowHeightKm нет', () => {
    const p = resolveTerrainLightParams(undefined, 'T')
    expect(p.cloudHeightKm).toBe(6)
    expect(p.cloudLightSoftness).toBe(0.1)
    expect('cloudShadowHeightKm' in p).toBe(false)
  })

  it('значения из данных и громкий отказ на невалидных', () => {
    const p = resolveTerrainLightParams({ cloudHeightKm: 50, cloudLightSoftness: 0.3 }, 'T')
    expect(p.cloudHeightKm).toBe(50)
    expect(p.cloudLightSoftness).toBe(0.3)
    expect(() => resolveTerrainLightParams({ cloudHeightKm: 0 }, 'T')).toThrow(/cloudHeightKm/)
    expect(() => resolveTerrainLightParams({ cloudLightSoftness: -0.1 }, 'T')).toThrow(/cloudLightSoftness/)
  })
})

describe('PlanetShader: юниформы облачного слоя', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('высота в юнитах и в км, мягкость; старый юниформ снят', () => {
    const shader = new PlanetShader(stubActor({ cloudHeightKm: 12, cloudLightSoftness: 0.2 }))
    expect(shader.uniforms.uCloudHeightUnits.value).toBe(toThreeJSUnits(12))
    expect(shader.uniforms.uCloudHeightKm.value).toBe(12)
    expect(shader.uniforms.uCloudLightSoftness.value).toBe(0.2)
    expect((shader.uniforms as Record<string, unknown>).uCloudShadowHeightUnits).toBeUndefined()
  })

  it('шаблон читает uCloudHeightUnits, не uCloudShadowHeightUnits', () => {
    expect(PlanetShaderTemplate.fragmentShader).not.toContain('uCloudShadowHeightUnits')
    expect(PlanetShaderTemplate.fragmentShader).toContain('uCloudHeightUnits')
  })
})

describe('SunTransmittance: тинт солнца на произвольном радиусе', () => {
  it('sunTintAt(r, muS) нормирует по зениту на том же радиусе; sunTint — на датуме', () => {
    expect(sunTransmittanceFunctions).toContain('vec3 sunTintAt(float r, float muS) {')
    expect(sunTransmittanceFunctions).toContain('vec3 zenith = max(atmoTransmittanceToSun(r, 1.0), vec3(1e-3));')
    expect(sunTransmittanceFunctions).toContain('return clamp(atmoTransmittanceToSun(r, muS) / zenith, 0.0, 1.0);')
    expect(sunTransmittanceFunctions).toContain('return sunTintAt(uAtmoDatumRadius, muS);')
  })
})
