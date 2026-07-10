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

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  }) as unknown as Actor

/* eslint-disable @typescript-eslint/no-explicit-any -- приватные поля в тестах, как в соседних спеках */

describe('AsteroidRingSystem: PBR-микрослой (детальные текстуры)', () => {
  it('текстуры доступны → слой включён, юниформы заполнены', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = (system as any).pool.geometryMesh.material.uniforms
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
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uDetailScale.value).toBeCloseTo(4 / toThreeJSUnits(10), 6)
    expect(u.uDetailSaturation.value).toBeCloseTo(0.1, 10)
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
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uDetailMapsEnabled.value).toBe(0)
  })
})
