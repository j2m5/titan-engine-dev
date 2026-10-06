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
  ringBandBinsFromPixels,
  thresholdBlurAndMask
} from '@/core/renderables/DetailedRingStreamingSystem/ringProfileBins'
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

})

describe('постобработка бинов профиля: размытие не заливает щель', () => {
  // Масштаб Thalorn: 1024 бина на 51 000 км, щель 360 км, σ = 6 бинов (~300 км, как у камней)
  const inner = 75000
  const outer = 126000
  const n = 1024
  const binKm = (outer - inner) / n
  const sigma = 6
  const gaps = ringGapsOf([moonlet], (km) => km)
  const center = (i: number): number => inner + ((i + 0.5) / n) * (outer - inner)
  const g = gaps[0]
  // Далеко от щели и от краёв кольца — за пределом ядра 3σ
  const far = (i: number): boolean =>
    Math.abs(center(i) - g.radius) > g.halfWidth + (3 * sigma + 1) * binKm && i > 3 * sigma + 1 && i < n - 3 * sigma - 2

  it('thresholdBlurAndMask: бины внутри (h − e) от центра щели — ровно 0, вдали — без изменений', () => {
    const values = new Float32Array(n).fill(0.8)
    const out = thresholdBlurAndMask(values, 0.01, sigma, inner, outer, gaps)
    let inside = 0
    for (let i = 0; i < n; i++) {
      if (Math.abs(center(i) - g.radius) <= g.halfWidth - g.edge) {
        inside++
        expect(out[i]).toBe(0)
      }
      if (far(i)) expect(out[i]).toBeCloseTo(0.8, 5)
    }
    expect(inside).toBeGreaterThan(0)
    expect(values.every((v) => v === Math.fround(0.8))).toBe(true)
  })

  it('без щелей — только порог и размытие', () => {
    const values = new Float32Array(n).fill(0.8)
    values[500] = 0.005
    const out = thresholdBlurAndMask(values, 0.01, 0, inner, outer, [])
    expect(out[500]).toBe(0)
    expect(out[499]).toBeCloseTo(0.8, 6)
  })

  it('полосы: щель гасит только альфу, RGB листа в щели прежний', () => {
    const pixels = new Uint8ClampedArray(n * 4)
    for (let i = 0; i < n; i++) pixels.set([200, 150, 100, 255], i * 4)
    const { color, alpha } = ringBandBinsFromPixels(pixels, n, sigma, inner, outer, gaps)
    for (let i = 0; i < n; i++) {
      const inGap = Math.abs(center(i) - g.radius) <= g.halfWidth - g.edge
      if (inGap) expect(alpha[i]).toBe(0)
      if (inGap || far(i)) {
        expect(color[i * 3]).toBeCloseTo(200 / 255, 5)
        expect(color[i * 3 + 1]).toBeCloseTo(150 / 255, 5)
        expect(color[i * 3 + 2]).toBeCloseTo(100 / 255, 5)
      }
      if (far(i)) expect(alpha[i]).toBeCloseTo(1, 5)
    }
  })

  it('readback строит бины через общий помощник', () => {
    const src = readFileSync('src/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback.ts', 'utf8')
    expect(src.slice(src.indexOf('function readRingAlphaBins'))).toContain('thresholdBlurAndMask(')
    expect(src.slice(src.indexOf('function readRingBandBins'))).toContain('ringBandBinsFromPixels(')
  })
})
