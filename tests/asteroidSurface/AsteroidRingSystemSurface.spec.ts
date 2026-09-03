import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { Actor } from '@/core/models/Actor'
import { poolOf } from '../helpers/ringSystemInternals'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 })
    }
  }) as unknown as Actor

describe('AsteroidRingSystem: профили облика', () => {
  it('дефолтом применяет профиль stony к L0-материалу', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = poolOf(system).geometryMaterial.uniforms
    expect(u.uRockColor.value.getHex()).toBe(ASTEROID_PROFILES.stony.baseColor)
    expect(u.uMariaStrength.value).toBe(ASTEROID_PROFILES.stony.mariaStrength)
    expect(u.uSpecularStrength.value).toBe(ASTEROID_PROFILES.stony.specularStrength)
  })

  it('уважает override profile: icy', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { profile: 'icy' })
    const u = poolOf(system).geometryMaterial.uniforms
    expect(u.uRockColor.value.getHex()).toBe(ASTEROID_PROFILES.icy.baseColor)
    expect(u.uSpecularPower.value).toBe(ASTEROID_PROFILES.icy.specularPower)
    expect(u.uMariaStrength.value).toBe(ASTEROID_PROFILES.icy.mariaStrength)
  })

  it('ручки BRDF профиля уходят и в L0, и в L1 — одна модель освещения на оба тира', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { profile: 'carbonaceous' })
    const l0 = poolOf(system).geometryMaterial.uniforms
    const l1 = poolOf(system).billboardMaterial.uniforms
    for (const u of [l0, l1]) {
      expect(u.uLunarMix.value).toBe(ASTEROID_PROFILES.carbonaceous.lunarMix)
      expect(u.uOppositionSurge.value).toBe(ASTEROID_PROFILES.carbonaceous.oppositionSurge)
    }
  })

  it('цвет билборда L1 — базовый цвет профиля, а не дефолт материала', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { profile: 'icy' })
    const l1 = poolOf(system).billboardMaterial.uniforms
    expect(l1.uColor.value.getHex()).toBe(ASTEROID_PROFILES.icy.baseColor)
  })
})

describe('AsteroidRingSystem: planetshine', () => {
  it('дефолты: тёплый серый и сила 1.5 в обоих материалах', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    for (const u of [poolOf(system).geometryMaterial.uniforms, poolOf(system).billboardMaterial.uniforms]) {
      expect(u.uPlanetshineColor.value.getHex()).toBe(0xb8ad9c)
      expect(u.uPlanetshineStrength.value).toBe(1.5)
    }
  })

  it('данные модели задают цвет строкой и силу', () => {
    const actor = {
      getAttribute: () => 42,
      renderingObject: {
        getAttribute: () => ({
          innerRadius: 70000,
          outerRadius: 140000,
          planetshineColor: '#9fd6e0',
          planetshineStrength: 0.8
        })
      }
    } as unknown as Actor
    const system = new AsteroidRingSystem(actor)
    const u = poolOf(system).billboardMaterial.uniforms
    expect(u.uPlanetshineColor.value.getHex()).toBe(0x9fd6e0)
    expect(u.uPlanetshineStrength.value).toBe(0.8)
  })
})
