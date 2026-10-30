import { describe, expect, it } from 'vitest'
import { RING_PENUMBRA_WEIGHTS, ringShadowTransmission } from '@/core/eclipse/ringPenumbraMath'
import { AppUniformsChunk } from '@/core/materials/shaders/lib/chunks'

const ring = (u: number): number => (u >= 0.4 && u <= 0.6 ? 0.8 : 0.1)

describe('ringShadowTransmission — CPU-зеркало полутени', () => {
  it('нулевая полутень — прежняя одна выборка внутри, 1 вне кольца', () => {
    expect(ringShadowTransmission(0.5, 0, ring)).toBeCloseTo(1 - 0.8, 12)
    expect(ringShadowTransmission(0.2, 0, ring)).toBeCloseTo(1 - 0.1, 12)
    expect(ringShadowTransmission(-0.1, 0, ring)).toBe(1)
    expect(ringShadowTransmission(1.1, 0, ring)).toBe(1)
  })
  it('переход через край щели монотонный на ширине полутени', () => {
    let prev = Infinity
    for (let u = 0.3; u <= 0.5; u += 0.01) {
      const t = ringShadowTransmission(u, 0.1, ring)
      expect(t).toBeLessThanOrEqual(prev + 1e-12)
      prev = t
    }
  })
  it('веса ядра суммируются в 9', () => {
    expect(RING_PENUMBRA_WEIGHTS.reduce((a, b) => a + b, 0)).toBe(9)
  })
})

describe('RingShadow defaults', () => {
  // GPU sampling, mip selection and gap masks are exercised in ringShadowGradients.gpu.ts.
  it('полутень выключена до установки углового размера солнца', () => {
    expect(AppUniformsChunk.ringShadowUniforms.uRingSunTan.value).toBe(0)
  })
})
