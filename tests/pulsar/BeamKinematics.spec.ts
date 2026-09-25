import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { beamPhaseAt, magneticAxisAt, beamDensity } from '@/core/renderables/Pulsar/beamKinematics'
import { J2000 } from '@/core/constants'

const TWO_PI = Math.PI * 2

describe('beamPhaseAt: фаза маяка от симуляционного времени', () => {
  it('на J2000 — фаза из данных; через период — та же фаза; через полпериода — +π', () => {
    const period = 4
    const day = 1 / 86400
    // Допуск 5e-4 рад: JD в сутках с двойной точностью даёт ~4e-5 с на эпохе J2000
    expect(beamPhaseAt(J2000, period, 0.3)).toBeCloseTo(0.3, 9)
    expect(beamPhaseAt(J2000 + period * day, period, 0.3)).toBeCloseTo(0.3, 3)
    expect(beamPhaseAt(J2000 + (period / 2) * day, period, 0.3)).toBeCloseTo((0.3 + Math.PI) % TWO_PI, 3)
  })

  it('через 10 000 суток фаза конечна и в [0, 2π): свёртка по 12 периодам не копит ошибку', () => {
    const phase = beamPhaseAt(J2000 + 10000, 4, 0)
    expect(Number.isFinite(phase)).toBe(true)
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phase).toBeLessThan(TWO_PI)
  })
})

describe('magneticAxisAt: магнитная ось вокруг оси вращения (+Y)', () => {
  it('tilt 0 — ось совпадает с +Y при любой фазе', () => {
    for (const phase of [0, 1, 2.5, 6]) {
      expect(magneticAxisAt(phase, 0, new Vector3()).distanceTo(new Vector3(0, 1, 0))).toBeCloseTo(0, 9)
    }
  })

  it('tilt 90° — ось лежит в плоскости XZ и обходит круг за 2π', () => {
    const a = magneticAxisAt(0, Math.PI / 2, new Vector3())
    const b = magneticAxisAt(Math.PI / 2, Math.PI / 2, new Vector3())

    expect(Math.abs(a.y)).toBeCloseTo(0, 9)
    expect(a.length()).toBeCloseTo(1, 9)
    expect(Math.abs(a.dot(b))).toBeCloseTo(0, 9)
  })

  it('tilt 30° — угол между осью и +Y всегда 30°', () => {
    for (const phase of [0, 1, 2, 3, 4, 5]) {
      const axis = magneticAxisAt(phase, Math.PI / 6, new Vector3())
      expect(axis.angleTo(new Vector3(0, 1, 0))).toBeCloseTo(Math.PI / 6, 9)
    }
  })
})

describe('beamDensity: сумма марша по оси', () => {
  it('24 шага середин по [0, L] с нормировкой dt/L дают ≈ intensity/3 (аналитический ∫(1−d/L)² = L/3), ±5 %', () => {
    const axis = new Vector3(0, 1, 0)
    const L = 1000
    const intensity = 6
    const steps = 24
    const dt = L / steps
    let sum = 0
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * dt
      sum += (beamDensity(axis.clone().multiplyScalar(t), axis, 0.1, L, intensity) * dt) / L
    }

    expect(sum).toBeGreaterThan((intensity / 3) * 0.95)
    expect(sum).toBeLessThan((intensity / 3) * 1.05)
  })
})

describe('beamDensity: гауссов конус со спадом по длине, оба знака оси', () => {
  const axis = new Vector3(0, 1, 0)
  const half = (6 * Math.PI) / 180
  const L = 100

  it('на оси в 10% длины — intensity·(0.9)², на противоположном луче столько же', () => {
    expect(beamDensity(new Vector3(0, 10, 0), axis, half, L, 6)).toBeCloseTo(6 * 0.81, 6)
    expect(beamDensity(new Vector3(0, -10, 0), axis, half, L, 6)).toBeCloseTo(6 * 0.81, 6)
  })

  it('на полуугле — в e раз слабее, чем на оси при той же дистанции', () => {
    const d = 10
    const onAxis = beamDensity(new Vector3(0, d, 0), axis, half, L, 6)
    const atHalf = beamDensity(new Vector3(d * Math.sin(half), d * Math.cos(half), 0), axis, half, L, 6)
    expect(atHalf / onAxis).toBeCloseTo(Math.exp(-1), 6)
  })

  it('за длиной луча и в самой точке — ноль (ближнее гашение 2% длины)', () => {
    expect(beamDensity(new Vector3(0, L, 0), axis, half, L, 6)).toBe(0)
    expect(beamDensity(new Vector3(0, L * 2, 0), axis, half, L, 6)).toBe(0)
    expect(beamDensity(new Vector3(0, 0, 0), axis, half, L, 6)).toBe(0)
  })

  it('перпендикулярно оси — практически ноль (90° при полуугле 6° — e^-225)', () => {
    expect(beamDensity(new Vector3(10, 0, 0), axis, half, L, 6)).toBeLessThan(1e-12)
  })
})
