import { Vector3 } from 'three'
import { DustParams, radialMask, tauRay } from './tauMirror'

/**
 * Тест точности аналитического интегратора оптической толщи пыли.
 *
 * tauMirror.ts — CPU-зеркало GLSL-функций чанка RingDust (ringDustTauRay и др.).
 * Здесь оно сверяется с ground truth — плотным численным интегралом
 * rho0 * radialMask(r) * exp(-|y|/H) вдоль луча.
 *
 * Сценарий = кольцо со скриншота владельца: inner 74500 км, outer 140220 км,
 * SpaceScale 10^-3.3, dustScaleHeightKm 150, dustHorizonKm 15000.
 */

const S = Math.pow(10, -3.3)
const toU = (km: number): number => km * S

const params: DustParams = {
  rho0: 1 / toU(15000),
  H: toU(150),
  rIn: toU(74500),
  rOut: toU(140220)
}

/** Ground truth: плотное численное интегрирование вдоль луча */
const tauGroundTruth = (origin: Vector3, dir: Vector3, tMax: number): number => {
  // Верхняя граница по радиальному выходу из внешнего цилиндра (+ запас)
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
  let sum = 0
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * dt
    const x = origin.x + dir.x * t
    const y = origin.y + dir.y * t
    const z = origin.z + dir.z * t
    const r = Math.hypot(x, z)
    sum += params.rho0 * radialMask(r, params) * Math.exp(-Math.abs(y) / params.H)
  }
  return sum * dt
}

const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => {
  const origin = new Vector3(ox, oy, oz)
  const dir = new Vector3(dx, dy, dz).normalize()
  return { origin, dir }
}

interface Case {
  name: string
  origin: Vector3
  dir: Vector3
  tMax: number
  /** Допустимая относительная ошибка (доля) при tau > absTol */
  relTol: number
}

const INF = 1e9
const cases: Case[] = [
  // Камера в слое, лучи объёма (tMax = inf)
  { name: 'в слое, вдоль плоскости', ...ray(50, 0.05, 0, 1, 0, 0), tMax: INF, relTol: 0.15 },
  { name: 'в слое, чуть вниз', ...ray(50, 0.2, 0, 1, -0.01, 0), tMax: INF, relTol: 0.15 },
  { name: 'в слое, круто вверх', ...ray(50, 0.05, 0, 0.3, 1, 0), tMax: INF, relTol: 0.15 },
  // Камера в дыре кольца (ракурс скриншота): луч через дыру на дальнюю сторону
  { name: 'из дыры через дыру на дальнюю сторону', ...ray(20, 0.2, 0, -1, 0, 0), tMax: INF, relTol: 0.15 },
  { name: 'из дыры к ближней кромке', ...ray(20, 0.2, 0, 1, -0.003, 0), tMax: INF, relTol: 0.15 },
  // Камера над слэбом
  { name: 'сверху сквозь слой', ...ray(45, 1.5, 0, 0.9, -0.08, 0), tMax: INF, relTol: 0.15 },
  { name: 'сверху по касательной к внешней кромке', ...ray(45, 1.5, 0, 1, -0.018, 0.3), tMax: INF, relTol: 0.3 },
  // Камера снаружи кольца
  { name: 'снаружи сквозь всё кольцо с дырой', ...ray(90, 0.3, 0, -1, -0.002, 0), tMax: INF, relTol: 0.15 },
  { name: 'снаружи мимо кольца', ...ray(90, 0.3, 0, 1, 0, 0), tMax: INF, relTol: 0.15 },
  // Камни (конечный tMax)
  { name: 'камень близко (2u)', ...ray(50, 0.05, 0, 1, 0, 0), tMax: 2, relTol: 0.15 },
  { name: 'камень на границе L1 (6u)', ...ray(50, 0.1, 0, 1, -0.01, 0), tMax: 6, relTol: 0.15 },
  { name: 'камень через кусок дыры', ...ray(36, 0.1, 0, 1, 0, 0), tMax: 10, relTol: 0.15 }
]

describe('RingDust analytic tau vs ground truth', () => {
  const absTol = 0.01

  for (const c of cases) {
    it(c.name, () => {
      const truth = tauGroundTruth(c.origin.clone(), c.dir.clone(), c.tMax)
      const { tau } = tauRay(c.origin.clone(), c.dir.clone(), c.tMax, params)

      if (truth < absTol) {
        expect(tau).toBeLessThan(absTol * 2)
      } else {
        const relErr = Math.abs(tau - truth) / truth
        expect(relErr).toBeLessThan(c.relTol)
      }
    })
  }

  it('tau непрерывен по направлению на силуэте внутренней стенки (нет "граней коробки")', () => {
    // Камера в дыре, два соседних луча: один упирается в верхнюю кромку внутренней
    // стенки, другой проходит чуть выше. tau обязан меняться плавно.
    const origin = new Vector3(20, 0.2, 0)
    const dirLow = new Vector3(1, 0.0129, 0).normalize() // чуть ниже кромки
    const dirHigh = new Vector3(1, 0.0133, 0).normalize() // чуть выше кромки
    const a = tauRay(origin.clone(), dirLow, 1e9, params).tau
    const b = tauRay(origin.clone(), dirHigh, 1e9, params).tau
    const alphaA = 1 - Math.exp(-a)
    const alphaB = 1 - Math.exp(-b)
    expect(Math.abs(alphaA - alphaB)).toBeLessThan(0.02)
  })

  it('tau растёт монотонно с дистанцией до камня (аэроперспектива)', () => {
    const origin = new Vector3(50, 0.05, 0)
    const dir = new Vector3(1, 0, 0)
    let prev = 0
    for (const tMax of [1, 2, 4, 8, 16]) {
      const { tau } = tauRay(origin.clone(), dir.clone(), tMax, params)
      expect(tau).toBeGreaterThanOrEqual(prev)
      prev = tau
    }
    expect(prev).toBeGreaterThan(0.5)
  })
})

// Регрессия "Покрытие прокси-оболочки" (артефакт n1/n2/n3, грани коробки на
// силуэте) отложена до SDD Task 3 (RingDustVolume + renderOrder): она
// импортирует DUST_SLAB_FACTOR из RingDustVolume.ts, которого в задаче 1 ещё
// не существует (Vite резолвит даже динамический import() на этапе
// трансформации файла, поэтому просто it.skip не спасает — весь файл не
// собирается). Восстановить тест в Task 3 сразу после создания файла:
//
// describe('Покрытие прокси-оболочки (регрессия "граней коробки")', () => {
//   it('alpha на границе оболочки невидима для худшего грейзинг-луча', async () => {
//     const { DUST_SLAB_FACTOR } = await import('@/core/renderables/DetailedRingStreamingSystem/RingDustVolume')
//     const boundaryY = DUST_SLAB_FACTOR * params.H
//     const half = Math.sqrt(params.rOut * params.rOut - params.rIn * params.rIn)
//     const origin = new Vector3(params.rIn, boundaryY, -half)
//     const dir = new Vector3(0, 0, 1)
//     const { tau } = tauRay(origin, dir, 1e9, params)
//     const alpha = 1 - Math.exp(-tau)
//     expect(alpha).toBeLessThan(0.005)
//   })
// })
