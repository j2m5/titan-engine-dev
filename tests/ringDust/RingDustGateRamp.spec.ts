import { Vector3 } from 'three'
import { angleGate, nearRamp, densityAt, tauMarch } from './tauMirror'
import type { DustParams } from './tauMirror'

const params: DustParams = { rho0: 0.02, H: 0.5, rIn: 70, rOut: 140 }

describe('ringDustAngleGate (зеркало)', () => {
  it('строго 0 при взгляде перпендикулярно плоскости кольца', () => {
    expect(angleGate(new Vector3(0, 1, 0), 2)).toBe(0)
    expect(angleGate(new Vector3(0, -1, 0), 2)).toBe(0)
  })

  it('равен 1 на скользящем луче в плоскости кольца', () => {
    expect(angleGate(new Vector3(1, 0, 0).normalize(), 2)).toBe(1)
  })

  it('монотонно убывает с ростом |dir.y|', () => {
    let prev = Infinity
    for (let y = 0; y <= 1.0001; y += 0.1) {
      const dir = new Vector3(Math.sqrt(Math.max(1 - y * y, 0)), y, 0)
      const g = angleGate(dir, 2)
      expect(g).toBeLessThanOrEqual(prev)
      prev = g
    }
  })

  it('больший anglePower гасит быстрее', () => {
    const dir = new Vector3(1, 0.5, 0).normalize()
    expect(angleGate(dir, 4)).toBeLessThan(angleGate(dir, 2))
  })
})

describe('ringDustNearRamp (зеркало)', () => {
  it('0 у камеры, 1 после дистанции полного проявления', () => {
    expect(nearRamp(0, 20)).toBe(0)
    expect(nearRamp(20, 20)).toBe(1)
    expect(nearRamp(35, 20)).toBe(1)
  })

  it('монотонно растёт на [0, nearFade]', () => {
    expect(nearRamp(5, 20)).toBeGreaterThan(nearRamp(2, 20))
    expect(nearRamp(15, 20)).toBeGreaterThan(nearRamp(5, 20))
  })
})

describe('ringDustDensityAt (зеркало)', () => {
  it('максимальна в средней плоскости, спадает по |y|', () => {
    const mid = densityAt(new Vector3(100, 0, 0), params)
    const up = densityAt(new Vector3(100, 1, 0), params)
    expect(mid).toBeGreaterThan(up)
    expect(up).toBeGreaterThan(0)
  })

  it('обнуляется вне кольца радиальной маской', () => {
    expect(densityAt(new Vector3(30, 0, 0), params)).toBe(0)
    expect(densityAt(new Vector3(200, 0, 0), params)).toBe(0)
  })
})

describe('tauMarch (зеркало марша объёма)', () => {
  // Плотный численный интеграл ρ(p(t))·ramp(t)·dt — эталон
  const denseTauRamped = (origin: Vector3, dir: Vector3, tMax: number, nearFade: number): number => {
    const N = 20000
    const dt = tMax / N
    let tau = 0
    const p = new Vector3()
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) * dt
      p.copy(dir).multiplyScalar(t).add(origin)
      tau += densityAt(p, params) * nearRamp(t, nearFade) * dt
    }
    return tau
  }

  const rays: Array<[Vector3, Vector3]> = [
    // Скользящий луч в средней плоскости изнутри кольца
    [new Vector3(100, 0.1, 0), new Vector3(-0.995, 0.02, 0.1).normalize()],
    // Через дыру кольца (два интервала)
    [new Vector3(-200, 2, 5), new Vector3(1, -0.012, -0.02).normalize()],
    // Снаружи под небольшим углом
    [new Vector3(180, 8, 40), new Vector3(-0.9, -0.05, -0.3).normalize()]
  ]

  it('midpoint-марш (jitter=0.5) на 64 шагах сходится к плотному интегралу (<6%)', () => {
    for (const [o, d] of rays) {
      const dense = denseTauRamped(o, d, 500, 20)
      const march = tauMarch(o, d, params, { steps: 64, jitter: 0.5, nearFade: 20 })
      expect(Math.abs(march - dense)).toBeLessThan(dense * 0.06 + 1e-6)
    }
  })

  it('бюджет MVP (16 шагов) остаётся в разумной полосе (<25%)', () => {
    for (const [o, d] of rays) {
      const dense = denseTauRamped(o, d, 500, 20)
      const march = tauMarch(o, d, params, { steps: 16, jitter: 0.5, nearFade: 20 })
      expect(Math.abs(march - dense)).toBeLessThan(dense * 0.25 + 1e-6)
    }
  })

  it('нулевой τ вне конуса кольца', () => {
    const march = tauMarch(new Vector3(300, 100, 0), new Vector3(0, 1, 0), params, { steps: 16, jitter: 0.5, nearFade: 20 })
    expect(march).toBe(0)
  })
})
