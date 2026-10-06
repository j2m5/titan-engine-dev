import { vi, type Mock } from 'vitest'

const fakeTexture: { name: string } = { name: 'ring.png' }

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => fakeTexture,
    getTextureOrMake: () => fakeTexture
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import type { DataTexture } from 'three'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { readRingAlphaBins, readRingBandBins } from '@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback'
import type { ShapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import type { ShapeModelData } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'
import { Actor } from '@/core/models/Actor'
import { internalsOf, poolOf } from '../helpers/ringSystemInternals'

/**
 * Разборка системы кольца: текстуры полос и радиального профиля пыли живут
 * только в юниформах материалов, а обход графа юниформы намеренно не трогает
 * (там бывают общие текстуры) — их освобождает dispose() самой системы.
 * Асинхронные приходы (реальные модели форм, лунки) после разборки ничего
 * не делают.
 */

const moonlet = { radiusKm: 106620, azimuthDeg: 40, sizeKm: 60, gapKm: 360, model: 'pandora' }

const makeFakeActor = (data: Record<string, unknown> = {}): Actor =>
  ({
    getAttribute: (key: string) => (key === 'name' ? 'Thalorn' : 42),
    renderingObject: {
      getAttribute: () => ({ innerRadius: 75000, outerRadius: 126000, ...data })
    },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  }) as unknown as Actor

const triangle = (): ShapeModelData => ({
  positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2])
})

const flush = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0))

function systemWithProfiles(): AsteroidRingSystem {
  ;(readRingBandBins as Mock).mockReturnValue({
    color: new Float32Array([1, 0, 0, 0, 0, 1]),
    alpha: new Float32Array([0.5, 1])
  })
  ;(readRingAlphaBins as Mock).mockReturnValue(new Float32Array([0.2, 1, 0.6, 0.9]))
  const system = new AsteroidRingSystem(makeFakeActor())
  internalsOf(system).__tryBuildDensityProfile()
  return system
}

describe('AsteroidRingSystem.dispose', () => {
  beforeEach(() => {
    ;(readRingBandBins as Mock).mockReset()
    ;(readRingAlphaBins as Mock).mockReset()
  })

  it('освобождает текстуры полос и профиля пыли и выключает полосы во всех материалах', () => {
    const system = systemWithProfiles()
    const l0 = poolOf(system).geometryMaterial.uniforms
    const band = l0.uRingBandMap.value as DataTexture
    const dust = l0.uDustRadialMap.value as DataTexture
    expect(band).not.toBeNull()
    expect(dust).not.toBeNull()
    const bandDispose = vi.spyOn(band, 'dispose')
    const dustDispose = vi.spyOn(dust, 'dispose')

    system.dispose()

    expect(bandDispose).toHaveBeenCalledTimes(1)
    expect(dustDispose).toHaveBeenCalledTimes(1)
    const sets = [l0, poolOf(system).billboardMaterial.uniforms, internalsOf(system).dustVolume!.dustMaterial.uniforms]
    for (const u of sets) {
      expect(u.uRingBandEnabled.value).toBe(0)
      expect(u.uRingBandMap.value).toBeNull()
      expect(u.uDustRadialMap.value).toBeNull()
    }
  })

  it('повторный dispose ничего не освобождает второй раз', () => {
    const system = systemWithProfiles()
    const band = poolOf(system).geometryMaterial.uniforms.uRingBandMap.value as DataTexture
    const bandDispose = vi.spyOn(band, 'dispose')

    system.dispose()
    system.dispose()

    expect(bandDispose).toHaveBeenCalledTimes(1)
  })

  it('обход графа (disposeSceneTree) доходит до dispose системы', () => {
    const system = systemWithProfiles()
    const band = poolOf(system).geometryMaterial.uniforms.uRingBandMap.value as DataTexture
    const bandDispose = vi.spyOn(band, 'dispose')

    disposeSceneTree(system)

    expect(bandDispose).toHaveBeenCalledTimes(1)
  })

  it('повторная постройка профиля пыли освобождает прежнюю текстуру', () => {
    const system = systemWithProfiles()
    const first = poolOf(system).geometryMaterial.uniforms.uDustRadialMap.value as DataTexture
    const firstDispose = vi.spyOn(first, 'dispose')

    ;(system as unknown as { __applyDustRadialBins(bins: Float32Array): void }).__applyDustRadialBins(
      new Float32Array([1, 0.5, 0.25, 1])
    )

    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(poolOf(system).geometryMaterial.uniforms.uDustRadialMap.value).not.toBe(first)
  })

  it('модели форм, пришедшие после разборки, не трогают пул', async () => {
    let resolve!: (data: ShapeModelData | null) => void
    const pending = new Promise<ShapeModelData | null>((r) => (resolve = r))
    const storage = { load: vi.fn(() => pending) } as unknown as ShapeModelStorage
    const system = new AsteroidRingSystem(makeFakeActor(), { archetypeCount: 4 }, null, storage)
    const replace = vi.spyOn(poolOf(system), 'replaceArchetypeGeometry')

    system.dispose()
    resolve(triangle())
    await flush()

    expect(replace).not.toHaveBeenCalled()
  })

  it('лунка, пришедшая после разборки, не добавляется в граф', async () => {
    let resolve!: (data: ShapeModelData | null) => void
    const pending = new Promise<ShapeModelData | null>((r) => (resolve = r))
    const storage = { load: vi.fn(() => pending) } as unknown as ShapeModelStorage
    const system = new AsteroidRingSystem(makeFakeActor({ moonlets: [moonlet] }), {}, null, storage)
    const moonletsBefore = system.children.filter((c) => c.name.startsWith('Moonlet:')).length

    system.dispose()
    resolve(triangle())
    await flush()

    expect(moonletsBefore).toBe(0)
    expect(system.children.filter((c) => c.name.startsWith('Moonlet:'))).toHaveLength(0)
  })
})
