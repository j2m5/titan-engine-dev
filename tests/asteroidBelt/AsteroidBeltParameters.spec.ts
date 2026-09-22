import { describe, it, expect } from 'vitest'
import { asteroidBeltParameters } from '@/core/renderables/AsteroidBelt/AsteroidBeltParameters'
import type { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'

function beltActor(data: IAsteroidBeltRenderingObject): Actor {
  return { renderingObject: { getAttribute: (): unknown => data } } as unknown as Actor
}

const MIN_DATA: IAsteroidBeltRenderingObject = {
  innerRadiusAu: 40,
  outerRadiusAu: 60,
  thicknessAu: 0.1,
  sizeRangeKm: [0.5, 60],
  spacingKm: 60
}

describe('asteroidBeltParameters: spacingKm', () => {
  it('поле отсутствует — дефолт 1, а не NaN (Math.max(undefined, 1) молча пустил бы пояс)', () => {
    const withoutSpacing: Record<string, unknown> = { ...MIN_DATA }
    delete withoutSpacing.spacingKm
    const p = asteroidBeltParameters(beltActor(withoutSpacing as unknown as IAsteroidBeltRenderingObject))
    expect(p.spacingKm).toBe(1)
  })

  it('заданное значение проходит клампом снизу в 1', () => {
    expect(asteroidBeltParameters(beltActor({ ...MIN_DATA, spacingKm: 0.2 })).spacingKm).toBe(1)
    expect(asteroidBeltParameters(beltActor({ ...MIN_DATA, spacingKm: 90 })).spacingKm).toBe(90)
  })
})

describe('asteroidBeltParameters: pointCount/pointScale (дальний слой точек)', () => {
  it('дефолты — 60000 точек, масштаб спрайта 220', () => {
    const p = asteroidBeltParameters(beltActor(MIN_DATA))
    expect(p.pointCount).toBe(60000)
    expect(p.pointScale).toBe(220)
  })

  it('pointCount клампится к неотрицательному', () => {
    const p = asteroidBeltParameters(beltActor({ ...MIN_DATA, pointCount: -5 }))
    expect(p.pointCount).toBe(0)
  })

  it('pointCount округляется вниз до целого', () => {
    const p = asteroidBeltParameters(beltActor({ ...MIN_DATA, pointCount: 1234.9 }))
    expect(p.pointCount).toBe(1234)
  })

  it('pointScale передаётся как есть, без клампа', () => {
    const p = asteroidBeltParameters(beltActor({ ...MIN_DATA, pointScale: 500 }))
    expect(p.pointScale).toBe(500)
  })
})
