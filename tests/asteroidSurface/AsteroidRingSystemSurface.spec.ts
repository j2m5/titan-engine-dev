import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'

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
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uRockColor.value.getHex()).toBe(ASTEROID_PROFILES.stony.baseColor)
    expect(u.uCraterDepth.value).toBe(ASTEROID_PROFILES.stony.craterDepth)
    expect(u.uSpecularStrength.value).toBe(ASTEROID_PROFILES.stony.specularStrength)
  })

  it('уважает override profile: icy', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { profile: 'icy' })
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uRockColor.value.getHex()).toBe(ASTEROID_PROFILES.icy.baseColor)
    expect(u.uSpecularPower.value).toBe(ASTEROID_PROFILES.icy.specularPower)
    expect(u.uCrackIntensity.value).toBe(ASTEROID_PROFILES.icy.crackIntensity)
  })

  it('разводит дистанционный фейд детали из конфига (в three-units)', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { detailFadeStartKm: 800, detailFadeEndKm: 2500 })
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uDetailFadeStart.value).toBeCloseTo(toThreeJSUnits(800), 6)
    expect(u.uDetailFadeEnd.value).toBeCloseTo(toThreeJSUnits(2500), 6)
  })
})
