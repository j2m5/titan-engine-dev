import { Vector3 } from 'three'
import { DustParams, densityAt, radialMask, tauMarch, tauRay } from './tauMirror'
import { normalizeDustBins } from '@/core/renderables/DetailedRingStreamingSystem/dust/DustRadialProfile'

/**
 * Точность интеграторов tau при радиальном профиле пыли из текстуры кольца
 * (uDustRadialMap): аналитическая закрытая форма (камни) и марш-квадратура
 * (объём) сверяются с плотным численным интегралом той же плотности.
 *
 * Профиль — сглаженные субкольца (реальный поступает через размытие
 * dustBleedKm, поэтому резких ступенек в нём не бывает).
 */

const S = Math.pow(10, -3.3)
const toU = (km: number): number => km * S

/** Сглаженный профиль субколец: два мягких пика + слабая подложка */
const makeProfileBins = (count: number): Float32Array => {
  const bins = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count
    bins[i] =
      Math.exp(-(((u - 0.3) / 0.08) ** 2)) + 0.6 * Math.exp(-(((u - 0.7) / 0.1) ** 2)) + 0.05
  }
  return bins
}

// Квантование как на GPU: профиль проходит через ту же нормировку в 8 бит
const { bytes, scale } = normalizeDustBins(makeProfileBins(256))!
const profileBins = Float32Array.from(bytes, (b) => b / 255)

const params: DustParams = {
  rho0: 1 / toU(15000),
  H: toU(150),
  rIn: toU(74500),
  rOut: toU(140220),
  profile: { bins: profileBins, scale }
}

/** Ground truth: плотное численное интегрирование плотности с профилем */
const tauGroundTruth = (origin: Vector3, dir: Vector3, tMax: number): number => {
  const a = dir.x * dir.x + dir.z * dir.z
  let tEnd = tMax
  if (a > 1e-12) {
    const b = origin.x * dir.x + origin.z * dir.z
    const c = origin.x * origin.x + origin.z * origin.z - params.rOut * params.rOut
    const disc = b * b - a * c
    if (disc <= 0) return 0
    const exit = (-b + Math.sqrt(disc)) / a
    if (exit <= 0) return 0
    tEnd = Math.min(tMax, exit + 1)
  } else {
    tEnd = Math.min(tMax, 100)
  }

  const N = 200000
  const dt = tEnd / N
  const p = new Vector3()
  let sum = 0
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * dt
    p.copy(dir).multiplyScalar(t).add(origin)
    sum += densityAt(p, params)
  }
  return sum * dt
}

const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => {
  const origin = new Vector3(ox, oy, oz)
  const dir = new Vector3(dx, dy, dz).normalize()
  return { origin, dir }
}

describe('RingDust tau с радиальным профилем пыли', () => {
  it('маска кромок модулируется профилем (проверка зеркала)', () => {
    const rMid = (params.rIn + params.rOut) / 2
    const uniform: DustParams = { ...params, profile: undefined }
    // В центре кольца маска кромок = 1 → отношение даёт чистую модуляцию
    const modulation = radialMask(rMid, params) / radialMask(rMid, uniform)
    expect(modulation).toBeGreaterThan(0)
    expect(modulation).not.toBeCloseTo(1, 1) // профиль реально меняет плотность
  })

  const absTol = 0.005
  const rockCases = [
    { name: 'камень близко, в слое (2u)', ...ray(50, 0.05, 0, 1, 0, 0), tMax: 2 },
    { name: 'камень на границе L1 (6u)', ...ray(50, 0.1, 0, 1, -0.01, 0), tMax: 6 },
    { name: 'камень через пик профиля', ...ray(40, 0.05, 0, 1, 0.002, 0.2), tMax: 8 },
    { name: 'камень через кусок дыры', ...ray(36, 0.1, 0, 1, 0, 0), tMax: 10 }
  ]

  for (const c of rockCases) {
    it(`закрытая форма (туман камней): ${c.name}`, () => {
      const truth = tauGroundTruth(c.origin.clone(), c.dir.clone(), c.tMax)
      const { tau } = tauRay(c.origin.clone(), c.dir.clone(), c.tMax, params)
      if (truth < absTol) {
        expect(tau).toBeLessThan(absTol * 2)
      } else {
        expect(Math.abs(tau - truth) / truth).toBeLessThan(0.25)
      }
    })
  }

  const volumeCases = [
    { name: 'в слое, вдоль плоскости', ...ray(50, 0.05, 0, 1, 0, 0) },
    { name: 'сверху сквозь слой', ...ray(45, 1.5, 0, 0.9, -0.08, 0) },
    { name: 'из дыры через дыру на дальнюю сторону', ...ray(20, 0.2, 0, -1, 0, 0) }
  ]

  for (const c of volumeCases) {
    it(`марш объёма: ${c.name}`, () => {
      const truth = tauGroundTruth(c.origin.clone(), c.dir.clone(), 1e9)
      const tau = tauMarch(c.origin.clone(), c.dir.clone(), params, {
        steps: 64,
        jitter: 0.5,
        nearFade: 0
      })
      if (truth < absTol) {
        expect(tau).toBeLessThan(absTol * 2)
      } else {
        expect(Math.abs(tau - truth) / truth).toBeLessThan(0.25)
      }
    })
  }

  it('пустотная полоса профиля даёт ~нулевую пыль (камень в щели)', () => {
    // Точка с минимальной модуляцией: u≈0.5 между пиками → плотность мала
    const uGap = 0.505
    const rGap = params.rIn + uGap * (params.rOut - params.rIn)
    const withProfile = densityAt(new Vector3(rGap, 0, 0), params)
    const uniform = densityAt(new Vector3(rGap, 0, 0), { ...params, profile: undefined })
    expect(withProfile).toBeLessThan(uniform * 0.3)
  })
})
