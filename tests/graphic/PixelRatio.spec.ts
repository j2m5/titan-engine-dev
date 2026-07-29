import { clampPixelRatio } from '@/core/graphic/renderingFactories'

describe('clampPixelRatio: кламп devicePixelRatio для рендерера', () => {
  it('ретина/4K зажимается до максимума (MSAA 8x и так дорогой)', () => {
    expect(clampPixelRatio(3, 2)).toBe(2)
    expect(clampPixelRatio(2.5, 2)).toBe(2)
  })

  it('обычные значения проходят без изменений', () => {
    expect(clampPixelRatio(1, 2)).toBe(1)
    expect(clampPixelRatio(1.5, 2)).toBe(1.5)
    expect(clampPixelRatio(2, 2)).toBe(2)
  })
})
