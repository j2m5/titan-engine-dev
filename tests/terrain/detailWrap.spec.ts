import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DETAIL_SCALE2_METERS,
  DEFAULT_DETAIL_SCALE_METERS,
  WRAP_TILES,
  detailWrapFor,
  wrapIndex,
  wrapUnitsFor,
  wrappedComponent
} from '@/core/terrain/detailWrap'
import { toThreeJSUnits } from '@/core/helpers/scaling'

describe('detailWrap: период обёртки детальных слоёв', () => {
  it('W = 1024 тайла в юнитах', () => {
    expect(WRAP_TILES).toBe(1024)
    expect(wrapUnitsFor(40)).toBeCloseTo(1024 * toThreeJSUnits(0.04), 15)
  })

  it('detailWrapFor: из ручек тела, дефолты 40/7 м', () => {
    const d = detailWrapFor(undefined)
    expect(d.w1).toBeCloseTo(wrapUnitsFor(DEFAULT_DETAIL_SCALE_METERS), 15)
    expect(d.w2).toBeCloseTo(wrapUnitsFor(DEFAULT_DETAIL_SCALE2_METERS), 15)
    const m = detailWrapFor({ detailScaleMeters: 35, detailScale2Meters: 6 })
    expect(m.w1).toBeCloseTo(wrapUnitsFor(35), 15)
    expect(m.w2).toBeCloseTo(wrapUnitsFor(6), 15)
  })

  it('detailWrapFor: невалидная ручка (0, NaN) — фолбэк на дефолт, не NaN', () => {
    expect(detailWrapFor({ detailScaleMeters: 0 }).w1).toBeCloseTo(wrapUnitsFor(DEFAULT_DETAIL_SCALE_METERS), 15)
    expect(detailWrapFor({ detailScaleMeters: Number.NaN }).w1).toBeCloseTo(wrapUnitsFor(DEFAULT_DETAIL_SCALE_METERS), 15)
  })

  it('wrapIndex — ближайшее целое число периодов; wrappedComponent вычитает ровно k·W', () => {
    expect(wrapIndex(0.49, 1)).toBe(0)
    expect(wrapIndex(0.51, 1)).toBe(1)
    expect(wrapIndex(-2.6, 1)).toBe(-3)
    expect(wrappedComponent(3.2, 3, 1)).toBeCloseTo(0.2, 12)
  })

  it('два патча с разными k: значения одной точки отличаются на кратное W', () => {
    const w = wrapUnitsFor(40)
    const p = 3.19
    const a = wrappedComponent(p, wrapIndex(p - 0.3 * w, w), w)
    const b = wrappedComponent(p, wrapIndex(p + 0.3 * w, w), w)
    expect(Number.isInteger(Math.round((a - b) / w))).toBe(true)
    expect(Math.abs((a - b) / w - Math.round((a - b) / w))).toBeLessThan(1e-9)
  })
})
