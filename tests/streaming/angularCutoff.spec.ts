import { describe, it, expect } from 'vitest'
import { minBodyPixelsToPriorityThreshold } from '@/core/streaming/angularCutoff'

describe('minBodyPixelsToPriorityThreshold', () => {
  it('дефолт 4 пикселя (fov 50°, 1080p) — порог ≈ 0.0016160456', () => {
    // Честный вывод см. в докблоке функции: prio = minBodyPixels·fovRad/(2·screenH).
    expect(minBodyPixelsToPriorityThreshold(4)).toBeCloseTo(0.0016160456, 9)
  })

  it('порог линеен по minBodyPixels — формула не содержит скрытых нелинейных членов', () => {
    const t1 = minBodyPixelsToPriorityThreshold(1)
    const t4 = minBodyPixelsToPriorityThreshold(4)

    expect(t4).toBeCloseTo(t1 * 4, 12)
  })

  it('minBodyPixels = 0 — порог нулевой, отсечка эффективно выключена', () => {
    expect(minBodyPixelsToPriorityThreshold(0)).toBe(0)
  })
})
