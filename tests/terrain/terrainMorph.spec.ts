import { describe, expect, it } from 'vitest'
import { stepMorph } from '@/core/terrain/terrainMorph'
import { config } from '@/core/framework/config'

describe('stepMorph', () => {
  it('линейный шаг к цели: delta / seconds за кадр', () => {
    expect(stepMorph(1, 0, 0.1, 0.4)).toBe(0.75)
    expect(stepMorph(0, 1, 0.1, 0.4)).toBe(0.25)
    expect(stepMorph(0.5, 1, 0.1, 0.4)).toBeCloseTo(0.75, 12)
  })

  it('кламп в [0, 1]: шаг не перелетает цель', () => {
    expect(stepMorph(0.9, 1, 1, 0.4)).toBe(1)
    expect(stepMorph(0.1, 0, 1, 0.4)).toBe(0)
    expect(stepMorph(1, 1, 0.1, 0.4)).toBe(1)
    expect(stepMorph(0, 0, 0.1, 0.4)).toBe(0)
  })

  it('seconds ≤ 0 — сразу цель', () => {
    expect(stepMorph(0.3, 0, 0.1, 0)).toBe(0)
    expect(stepMorph(0.3, 1, 0.1, 0)).toBe(1)
    expect(stepMorph(0.3, 1, 0.1, -1)).toBe(1)
  })

  it('delta = 0 — без изменений', () => {
    expect(stepMorph(0.3, 0, 0, 0.4)).toBe(0.3)
    expect(stepMorph(0.3, 1, 0, 0.4)).toBe(0.3)
  })

  it('дефолт terrain.lod.morphSeconds = 0.4', () => {
    expect(config('terrain.lod.morphSeconds')).toBe(0.4)
  })
})
