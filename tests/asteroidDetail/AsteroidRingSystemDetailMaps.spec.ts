import { vi } from 'vitest'

const fakeTexture = { name: 'any' }
// Мок хранилища: отдаём текстуру на любые пути → детальный слой включится
vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => fakeTexture, getTextureOrMake: () => fakeTexture }
}))
vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null)
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { poolOf } from '../helpers/ringSystemInternals'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  }) as unknown as Actor

describe('AsteroidRingSystem: PBR-микрослой (детальные текстуры)', () => {
  it('текстуры доступны → слой включён, юниформы заполнены', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = poolOf(system).geometryMaterial.uniforms
    expect(u.uDetailMapsEnabled.value).toBe(1)
    expect(u.uRockDiffMap.value).toBe(fakeTexture)
    expect(u.uRockNorMap.value).toBe(fakeTexture)
    expect(u.uRockArmMap.value).toBe(fakeTexture)
    // Масштаб: detailRepeats повторов на радиус камня (в TU)
    expect(u.uDetailScale.value).toBeCloseTo(2.0 / toThreeJSUnits(10), 6)
    expect(u.uDetailSaturation.value).toBeCloseTo(0.35, 10)
  })

  it('ручки конфига переопределяют дефолты', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { detailRepeats: 4, detailSaturation: 0.1 })
    const u = poolOf(system).geometryMaterial.uniforms
    expect(u.uDetailScale.value).toBeCloseTo(4 / toThreeJSUnits(10), 6)
    expect(u.uDetailSaturation.value).toBeCloseTo(0.1, 10)
  })
})

describe('AsteroidRingSystem: пер-профильный PBR-сет', () => {
  it('профиль icy запрашивает у resourceStorage пути rocks_ground_04', async () => {
    vi.resetModules()
    const getTexture = vi.fn((_key: string) => fakeTexture)
    vi.doMock('@/core/services/ResourceStorage', () => ({
      resourceStorage: { getTexture, getTextureOrMake: () => fakeTexture }
    }))
    const { AsteroidRingSystem: Sys } = await import('@/core/renderables/DetailedRingStreamingSystem')
    new Sys(makeFakeActor(), { profile: 'icy' })

    const calledPaths = getTexture.mock.calls.map((args) => args[0])
    expect(calledPaths).toContain('asteroids/rocks_ground_04_diff_2k.jpg')
    expect(calledPaths).toContain('asteroids/rocks_ground_04_nor_gl_2k.jpg')
    expect(calledPaths).toContain('asteroids/rocks_ground_04_arm_2k.jpg')
  })

  it('дефолтный профиль (stony) продолжает запрашивать rock_boulder_dry', async () => {
    vi.resetModules()
    const getTexture = vi.fn((_key: string) => fakeTexture)
    vi.doMock('@/core/services/ResourceStorage', () => ({
      resourceStorage: { getTexture, getTextureOrMake: () => fakeTexture }
    }))
    const { AsteroidRingSystem: Sys } = await import('@/core/renderables/DetailedRingStreamingSystem')
    new Sys(makeFakeActor())

    const calledPaths = getTexture.mock.calls.map((args) => args[0])
    expect(calledPaths).toContain('asteroids/rock_boulder_dry_diff_2k.jpg')
    expect(calledPaths).toContain('asteroids/rock_boulder_dry_nor_gl_2k.jpg')
    expect(calledPaths).toContain('asteroids/rock_boulder_dry_arm_2k.jpg')
  })
})

describe('AsteroidRingSystem: PBR-микрослой недоступен', () => {
  it('нет текстур → слой выключен (uDetailMapsEnabled 0)', async () => {
    vi.resetModules()
    vi.doMock('@/core/services/ResourceStorage', () => ({
      resourceStorage: { getTexture: () => undefined, getTextureOrMake: () => fakeTexture }
    }))
    const { AsteroidRingSystem: Sys } = await import('@/core/renderables/DetailedRingStreamingSystem')
    const system = new Sys(makeFakeActor())
    const u = poolOf(system).geometryMaterial.uniforms
    expect(u.uDetailMapsEnabled.value).toBe(0)
  })
})
