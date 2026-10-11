import { Vector3 } from 'three'
import { advanceDetailMix, asteroidDetailWeight, detailEndDistance } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorDetail'

describe('Детали перед переходом в импостор', () => {
  it('сводит микрослой к нулю до смены LOD сектора, без скачка в начале', () => {
    const end = detailEndDistance(100, 20)
    expect(end).toBe(80)
    expect(asteroidDetailWeight(60, end, 1, 0.75)).toBe(1)
    expect(asteroidDetailWeight(60 + 1e-5, end, 1, 0.75)).toBeCloseTo(1, 10)
    expect(asteroidDetailWeight(70, end, 0.4, 0.75)).toBeCloseTo(0.2)
    expect(asteroidDetailWeight(80, end, 1, 0.75)).toBe(0)
    expect(detailEndDistance(10, 20)).toBe(0)
    expect(asteroidDetailWeight(10, 0, 0, 0.75)).toBe(1)
  })

  it('сохраняет mix при реверсе и не выходит за целевой вес', () => {
    expect(advanceDetailMix(0.4, 1, 0.1, 2)).toBeCloseTo(0.6)
    expect(advanceDetailMix(0.6, 0, 0.1, 2)).toBeCloseTo(0.4)
    expect(advanceDetailMix(0.4, 1, 2, 2)).toBe(1)
    expect(advanceDetailMix(0.4, 0, 2, 2)).toBe(0)
    expect(advanceDetailMix(0.4, 1, 0, Infinity)).toBe(0.4)
  })

  it('все точки ограничивающей сферы гасят детали к границе переключения', () => {
    const camera = new Vector3(100, 0, 0), end = detailEndDistance(100, 20)
    for (let i = 0; i < 200; i++) {
      const p = new Vector3(Math.sin(i * 1.7), Math.cos(i * 0.7), Math.sin(i * 2.3)).normalize().multiplyScalar(20)
      const delta = p.sub(camera)
      expect(asteroidDetailWeight(delta.length(), end, 1, 0.75)).toBe(0)
      expect(asteroidDetailWeight(Math.hypot(delta.x, delta.z), end, 1, 0.75)).toBe(0)
    }
    const delta = new Vector3(10, 200, 0)
    expect(asteroidDetailWeight(Math.hypot(delta.x, delta.z), end, 1, 0.75)).toBe(1)
    expect(asteroidDetailWeight(delta.length(), end, 1, 0.75)).toBe(0)
  })
})
