import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { Actor } from '@/core/models/Actor'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 })
    }
  }) as unknown as Actor

describe('InstancedAsteroidShaderTemplate: surfaceData (freshness/cavity)', () => {
  it('вершинник несёт attribute surfaceData → varying vSurfaceData', () => {
    expect(InstancedAsteroidShaderTemplate.vertexShader).toContain('attribute vec4 surfaceData;')
    expect(InstancedAsteroidShaderTemplate.vertexShader).toContain('varying vec2 vSurfaceData;')
    expect(InstancedAsteroidShaderTemplate.vertexShader).toContain('vSurfaceData = surfaceData.xy;')
  })

  it('фрагментник объявляет varying и модулирует альбедо/specStrength/surfAO', () => {
    const frag = InstancedAsteroidShaderTemplate.fragmentShader
    expect(frag).toContain('varying vec2 vSurfaceData;')
    expect(frag).toContain('albedo *= 1.0 + uFreshnessBrighten * vSurfaceData.x;')
    expect(frag).toContain('specStrength *= 1.0 + 0.5 * vSurfaceData.x;')
    expect(frag).toContain('surfAO *= 1.0 - uCavityShade * vSurfaceData.y;')
  })

  it('модуляция идёт ПОСЛЕ трипланарного блока и ДО перехода нормали во view', () => {
    const frag = InstancedAsteroidShaderTemplate.fragmentShader
    const triplanarEnd = frag.indexOf('specPower = max(specPower * gloss, 2.0);')
    const modulation = frag.indexOf('albedo *= 1.0 + uFreshnessBrighten * vSurfaceData.x;')
    const viewTransform = frag.indexOf('normal = normalize(vObjToView * objN);')
    expect(triplanarEnd).toBeGreaterThan(-1)
    expect(modulation).toBeGreaterThan(triplanarEnd)
    expect(viewTransform).toBeGreaterThan(modulation)
  })

  it('НЕ хеширует vSurfaceData во фрагментнике (прямое использование, ULP-правило)', () => {
    const frag = InstancedAsteroidShaderTemplate.fragmentShader
    expect(frag).not.toMatch(/hash\w*\([^)]*vSurfaceData/)
  })

  it('юниформы uFreshnessBrighten/uCavityShade в template с дефолтами 0.15/0.5', () => {
    expect(InstancedAsteroidShaderTemplate.uniforms.uFreshnessBrighten?.value).toBe(0.15)
    expect(InstancedAsteroidShaderTemplate.uniforms.uCavityShade?.value).toBe(0.5)
  })
})

describe('InstancedAsteroidShader: surfaceData юниформы', () => {
  it('дефолты 0.15/0.5 в записи инстанса шейдера', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.uniforms.uFreshnessBrighten.value).toBe(0.15)
    expect(shader.uniforms.uCavityShade.value).toBe(0.5)
  })
})

describe('AsteroidRingSystem: проводка freshness/cavity из профиля', () => {
  it('профиль icy проводит uFreshnessBrighten=0.3, uCavityShade=0.35', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { profile: 'icy' })
    const u = (system as any).pool.geometryMaterial.uniforms
    expect(u.uFreshnessBrighten.value).toBe(ASTEROID_PROFILES.icy.freshnessBrighten)
    expect(u.uCavityShade.value).toBe(ASTEROID_PROFILES.icy.cavityShade)
    expect(u.uFreshnessBrighten.value).toBe(0.3)
    expect(u.uCavityShade.value).toBe(0.35)
  })

  it('дефолтный профиль stony проводит uFreshnessBrighten=0.15, uCavityShade=0.5', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = (system as any).pool.geometryMaterial.uniforms
    expect(u.uFreshnessBrighten.value).toBe(ASTEROID_PROFILES.stony.freshnessBrighten)
    expect(u.uCavityShade.value).toBe(ASTEROID_PROFILES.stony.cavityShade)
  })
})
