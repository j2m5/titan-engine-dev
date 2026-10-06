import { vi, type Mock } from 'vitest'
import { readFileSync } from 'node:fs'

const fakeTexture = { name: 'ring.png' }

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => fakeTexture,
    getTextureOrMake: () => fakeTexture
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import type { RadialDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/RadialDensityProfile'
import { ringGapsOf } from '@/core/renderables/DetailedRingStreamingSystem/ringMoonlets'
import {
  readRingAlphaProfile,
  readRingAlphaBins,
  readRingBandBins
} from '@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { RingMoonlet } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { internalsOf } from '../helpers/ringSystemInternals'

const moonlet: RingMoonlet = { radiusKm: 106620, azimuthDeg: 40, sizeKm: 30, gapKm: 360, model: 'pandora' }

const makeFakeActor = (): Actor =>
  ({
    getAttribute: (key: string) => (key === 'name' ? 'Thalorn' : 42),
    renderingObject: {
      getAttribute: () => ({ innerRadius: 75000, outerRadius: 126000, alphaTest: 0.01, moonlets: [moonlet] })
    },
    resources: {
      first: () => ({ getAttribute: () => 'ring.png' })
    }
  }) as unknown as Actor

describe('щели лунок в CPU-профилях кольца', () => {
  beforeEach(() => {
    ;(readRingAlphaProfile as Mock).mockReset()
    ;(readRingAlphaBins as Mock).mockReset()
    ;(readRingAlphaBins as Mock).mockReturnValue(null)
    ;(readRingBandBins as Mock).mockClear()
  })

  it('readback получает щели лунок в юнитах сцены — профиль камней, пыль и полосы', () => {
    ;(readRingAlphaProfile as Mock).mockReturnValue(null)
    const system = new AsteroidRingSystem(makeFakeActor())
    internalsOf(system).__tryBuildDensityProfile()

    const gaps = ringGapsOf([moonlet], toThreeJSUnits)
    const args = [expect.anything(), expect.any(Number), expect.any(Number), expect.objectContaining({ gaps })]
    expect(readRingAlphaProfile).toHaveBeenCalledWith(...args)
    expect(readRingAlphaBins).toHaveBeenCalledWith(...args)
    expect(readRingBandBins).toHaveBeenCalledWith(...args)
  })

  it('нечитаемая текстура при непустых щелях — камни в щель не ложатся', () => {
    ;(readRingAlphaProfile as Mock).mockReturnValue(null)
    const system = new AsteroidRingSystem(makeFakeActor())
    internalsOf(system).__tryBuildDensityProfile()

    const generator = (system as unknown as { cascadeGenerators: Array<{ densityProfile: RadialDensityProfile | null }> })
      .cascadeGenerators[0]
    const profile = generator.densityProfile
    expect(profile).not.toBeNull()
    const inner = toThreeJSUnits(75000)
    const outer = toThreeJSUnits(126000)
    const center = toThreeJSUnits(106620)
    const clear = toThreeJSUnits(180 - 27) - (outer - inner) / 1024
    for (let k = 0; k < 20000; k++) {
      const r = profile!.sampleRadius(inner, outer, (k + 0.5) / 20000)
      expect(Math.abs(r - center) >= clear).toBe(true)
    }
  })

  it('маска щелей применяется к альфе до порога и размытия', () => {
    const src = readFileSync('src/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback.ts', 'utf8')
    const bins = src.slice(src.indexOf('function readRingAlphaBins'))
    expect(bins.indexOf('applyRingGapsToBins(alpha')).toBeGreaterThan(-1)
    expect(bins.indexOf('applyRingGapsToBins(alpha')).toBeLessThan(bins.indexOf('thresholdAndBlur('))
    const band = src.slice(src.indexOf('function readRingBandBins'))
    expect(band).toContain('applyRingGapsToBins(')
  })
})
