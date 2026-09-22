import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { distanceToTorus, nextState, BeltLodState } from '@/core/renderables/DetailedRingStreamingSystem/beltDistance'

describe('distanceToTorus', () => {
  const inner = 40
  const outer = 60
  const halfThickness = 1

  it('внутри тора — ноль', () => {
    expect(distanceToTorus(new Vector3(50, 0, 0), inner, outer, halfThickness)).toBe(0)
    // и на самих границах, и внутри толщины
    expect(distanceToTorus(new Vector3(40, 0.5, 0), inner, outer, halfThickness)).toBe(0)
    expect(distanceToTorus(new Vector3(60, -1, 0), inner, outer, halfThickness)).toBe(0)
  })

  it('снаружи по радиусу — разность до ближайшей границы', () => {
    expect(distanceToTorus(new Vector3(70, 0, 0), inner, outer, halfThickness)).toBeCloseTo(10, 10)
    expect(distanceToTorus(new Vector3(0, 0, 30), inner, outer, halfThickness)).toBeCloseTo(10, 10)
  })

  it('над плоскостью — превышение половины толщины', () => {
    expect(distanceToTorus(new Vector3(50, 3, 0), inner, outer, halfThickness)).toBeCloseTo(2, 10)
    expect(distanceToTorus(new Vector3(50, -3, 0), inner, outer, halfThickness)).toBeCloseTo(2, 10)
  })

  it('комбинация — гипотенуза радиальной и высотной составляющих', () => {
    const d = distanceToTorus(new Vector3(70, 3, 0), inner, outer, halfThickness)
    expect(d).toBeCloseTo(Math.hypot(10, 2), 10)
  })
})

describe('nextState — гистерезис против мигания у порога', () => {
  const thresholds = { near: 10, mid: 100 }

  it('ровно на пороге near состояние не меняется, откуда бы ни пришли', () => {
    expect(nextState(BeltLodState.Near, 10, thresholds)).toBe(BeltLodState.Near)
    expect(nextState(BeltLodState.Mid, 10, thresholds)).toBe(BeltLodState.Mid)
  })

  it('ровно на пороге mid состояние не меняется, откуда бы ни пришли', () => {
    expect(nextState(BeltLodState.Mid, 100, thresholds)).toBe(BeltLodState.Mid)
    expect(nextState(BeltLodState.Far, 100, thresholds)).toBe(BeltLodState.Far)
  })

  it('Near -> Mid только за верхней границей полосы гистерезиса у near', () => {
    expect(nextState(BeltLodState.Near, 10.5, thresholds)).toBe(BeltLodState.Near)
    expect(nextState(BeltLodState.Near, 12, thresholds)).toBe(BeltLodState.Mid)
  })

  it('Mid -> Near только за нижней границей полосы гистерезиса у near', () => {
    expect(nextState(BeltLodState.Mid, 9.5, thresholds)).toBe(BeltLodState.Mid)
    expect(nextState(BeltLodState.Mid, 8, thresholds)).toBe(BeltLodState.Near)
  })

  it('Mid -> Far только за верхней границей полосы гистерезиса у mid', () => {
    expect(nextState(BeltLodState.Mid, 105, thresholds)).toBe(BeltLodState.Mid)
    expect(nextState(BeltLodState.Mid, 120, thresholds)).toBe(BeltLodState.Far)
  })

  it('Far -> Mid только за нижней границей полосы гистерезиса у mid', () => {
    expect(nextState(BeltLodState.Far, 95, thresholds)).toBe(BeltLodState.Far)
    expect(nextState(BeltLodState.Far, 80, thresholds)).toBe(BeltLodState.Mid)
  })

  it('Far -> Near одним прыжком, если расстояние сразу меньше нижней границы near', () => {
    expect(nextState(BeltLodState.Far, 0, thresholds)).toBe(BeltLodState.Near)
  })
})
