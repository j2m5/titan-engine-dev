import { describe, it, expect } from 'vitest'
import { sunAngularRadius } from '@/core/renderables/Atmosphere/AtmosphereConfig'

describe('sunAngularRadius', () => {
  it('Солнце с Земли', () => {
    expect(sunAngularRadius(695700, 1)).toBeCloseTo(0.00465, 5)
  })

  it('совпадает со строкой Коррибана, вписанной руками', () => {
    // Horuset: R = 800055 км, a = 1.62 а.е.
    expect(sunAngularRadius(800055, 1.62)).toBeCloseTo(0.00330125, 6)
  })

  it('W26 с орбит новых тел', () => {
    expect(sunAngularRadius(1.06e9, 32)).toBeCloseTo(0.218, 3)
    expect(sunAngularRadius(1.06e9, 72)).toBeCloseTo(0.0981, 3)
    expect(sunAngularRadius(1.06e9, 115)).toBeCloseTo(0.0615, 3)
  })
})
