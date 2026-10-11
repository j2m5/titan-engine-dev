import { Vector3 } from 'three'
import { encodeImpostorTexel, decodeImpostorTexel, averageImpostorTexels, captureProjection } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorData'

const basis = { direction: new Vector3(0, 0, 1), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) }
const sample = { normal: new Vector3(1, 0, 0), depth01: 0.6, freshness: 0.8, cavity: 0.2, coverage: 0.25 }

describe('данные импостора и коррекция глубины', () => {
  it('записывает глубину и свойства с покрытием, включая normal alpha', () => {
    const packed = encodeImpostorTexel(sample)
    expect(packed.normalDepth).toEqual([0.25, 0.125, 0.125, 0.15])
    expect(packed.surfaceCoverage).toEqual([0.2, 0.05, 0, 0.25])
  })

  it('прозрачные соседи уменьшают покрытие, но не меняют поверхность', () => {
    const solid = encodeImpostorTexel(sample)
    const empty = encodeImpostorTexel({ ...sample, coverage: 0 })
    const mixed = averageImpostorTexels([solid, empty, empty, empty])
    const decoded = decodeImpostorTexel(mixed)!
    expect(decoded.coverage).toBe(0.0625)
    expect(decoded.normal.toArray()).toEqual([1, 0, 0])
    expect(decoded.depth01).toBeCloseTo(0.6)
    expect(decoded.freshness).toBeCloseTo(0.8)
    expect(decoded.cavity).toBeCloseTo(0.2)
  })

  it('не создаёт поверхность из пустоты, нечисловых значений и нулевой нормали', () => {
    expect(decodeImpostorTexel(encodeImpostorTexel({ ...sample, coverage: 0 }))).toBeNull()
    expect(decodeImpostorTexel({ normalDepth: [NaN, 0, 0, 0], surfaceCoverage: [0, 0, 0, 1] })).toBeNull()
    expect(decodeImpostorTexel({ normalDepth: [0.5, 0.5, 0.5, 0.5], surfaceCoverage: [0, 0, 0, 1] })).toBeNull()
  })

  it('пересчитывает UV по глубине и оставляет вторую точку на луче', () => {
    const origin = new Vector3(0, 0, 3)
    const ray = new Vector3(0.2, 0, -1)
    const plane = captureProjection(origin, ray, basis, 1, 0.5)!
    expect(plane.t).toBe(3)
    expect(plane.uv.x).toBeCloseTo(0.8)
    const corrected = captureProjection(origin, ray, basis, 1, 0.75)!
    expect(corrected.t).toBe(2.5)
    expect(corrected.uv.x).toBeCloseTo(0.75)
    const second = captureProjection(origin, ray, basis, 1, 0.7)!
    expect(second.t).toBeCloseTo(2.6)
    expect(second.uv.x).toBeCloseTo(0.76)
    const point = origin.clone().addScaledVector(ray, second.t)
    expect(point.z).toBeCloseTo(0.4)
    expect(point.clone().sub(origin).cross(ray).length()).toBeLessThan(1e-12)
  })

  it('не тянет край кадра к соседу при неверном луче', () => {
    const origin = new Vector3(0, 0, 3)
    expect(captureProjection(origin, new Vector3(1, 0, 0), basis, 1, 0.5)).toBeNull()
    expect(captureProjection(origin, new Vector3(0, 0, 1), basis, 1, 0.5)).toBeNull()
    expect(captureProjection(origin, new Vector3(2, 0, -1), basis, 1, 0.5)).toBeNull()
    expect(captureProjection(origin, new Vector3(0, 0, -1), basis, 0, 0.5)).toBeNull()
    expect(captureProjection(origin, new Vector3(0, 0, -1), basis, 1, NaN)).toBeNull()
  })
})
