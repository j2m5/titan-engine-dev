import { Vector3 } from 'three'

/**
 * CPU-зеркало GLSL-функций чанка RingDust (аналитическое интегрирование
 * оптической толщи пыли вдоль луча).
 *
 * ВАЖНО: менять строго синхронно с
 * src/core/materials/shaders/lib/chunks/RingDust.ts — тесты точности
 * (RingDustTauAccuracy.spec.ts) проверяют именно эту реализацию, GLSL
 * обязан повторять её один в один.
 *
 * Модель: rho(p) = rho0 * radialMask(|p.xz|) * exp(-|p.y| / H),
 * кольцо в плоскости XZ, нормаль Y (ring-local space).
 *
 * tau вдоль луча считается аналитически:
 * - радиальные интервалы = пересечение луча с внешним цилиндром минус
 *   интервал внутреннего цилиндра (дыра кольца корректно вычитается);
 * - вертикальная экспонента интегрируется в замкнутой форме через нечётную
 *   первообразную F(u) = sign(u) * H * (1 - exp(-|u|/H));
 * - маска кромок сэмплируется в 4 тапах по квантилям экспоненциальной массы
 *   [0.125, 0.375, 0.625, 0.875].
 */

interface DustParams {
  /** Оптическая плотность в средней плоскости, tau на юнит */
  rho0: number
  /** Масштабная полутолщина слоя H, юниты */
  H: number
  /** Внутренний радиус кольца, юниты */
  rIn: number
  /** Внешний радиус кольца, юниты */
  rOut: number
  /**
   * Радиальный профиль пыли из альфы текстуры кольца (зеркало
   * uDustRadialMap + uDustRadialMapScale). undefined → равномерная пыль.
   * bins — значения текселей R-канала [0..1], scale — нормирующий множитель.
   */
  profile?: { bins: ArrayLike<number>; scale: number }
}

interface TauResult {
  tau: number
  /** Объединённый диапазон [tStart, tEnd] пылевых интервалов вдоль луча (для якорей шума) */
  span: [number, number]
}

const EMPTY: [number, number] = [1, 0]
const BIG = 1e9

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Линейная выборка 1D-текстуры профиля (зеркало texture2D с LinearFilter +
 * ClampToEdgeWrapping): тексели центрированы в (i + 0.5) / n.
 */
const sampleProfile = (u: number, bins: ArrayLike<number>): number => {
  const x = Math.min(Math.max(u, 0), 1) * bins.length - 0.5
  const i0 = Math.floor(x)
  const frac = x - i0
  const a = bins[Math.min(Math.max(i0, 0), bins.length - 1)]
  const b = bins[Math.min(Math.max(i0 + 1, 0), bins.length - 1)]
  return a + (b - a) * frac
}

/** Маска кромок кольца × радиальный профиль пыли (зеркало ringDustRadialMask) */
const radialMask = (r: number, p: DustParams): number => {
  const edge = (p.rOut - p.rIn) * 0.12
  let mask = smoothstep(p.rIn, p.rIn + edge, r) * (1 - smoothstep(p.rOut - edge, p.rOut, r))
  if (p.profile) {
    const u = (r - p.rIn) / (p.rOut - p.rIn)
    mask *= sampleProfile(u, p.profile.bins) * p.profile.scale
  }
  return mask
}

/** Плотность пыли в точке (зеркало ringDustDensityAt) */
const densityAt = (p: Vector3, params: DustParams): number =>
  params.rho0 * radialMask(Math.hypot(p.x, p.z), params) * Math.exp(-Math.abs(p.y) / Math.max(params.H, 1e-6))

/** Гейт по углу луча к плоскости кольца (зеркало ringDustAngleGate) */
const angleGate = (dir: Vector3, power: number): number =>
  Math.pow(Math.max(1 - Math.abs(dir.y), 0), power)

/** Рамп ближней дистанции (зеркало ringDustNearRamp) */
const nearRamp = (t: number, nearFade: number): number => smoothstep(0, Math.max(nearFade, 1e-6), t)

interface MarchOptions {
  /** Бюджет шагов (зеркало uDustMaxSteps) */
  steps: number
  /** Джиттер стартового смещения в долях шага, 0..1 (0.5 = midpoint rule) */
  jitter: number
  /** Дистанция полного проявления пыли (зеркало uDustNearFade), юниты */
  nearFade: number
}

/**
 * Марш-квадратура τ вдоль луча — зеркало цикла RingDustRaymarchMaterial.
 * Интервалы: внешний цилиндр минус дыра, обрезка по вертикальной оболочке
 * |y| <= 12H. Шаги распределяются по объединённой длине интервалов.
 */
const tauMarch = (origin: Vector3, dir: Vector3, params: DustParams, opts: MarchOptions): number => {
  const outer = circleInterval(origin, dir, params.rOut)
  const o0 = Math.max(outer[0], 0)
  const o1 = outer[1]
  if (o1 <= o0) return 0

  const inner = circleInterval(origin, dir, params.rIn)
  const h0 = Math.max(inner[0], o0)
  const h1 = Math.min(inner[1], o1)
  const hasHole = h1 > h0

  let segA: [number, number] = hasHole ? [o0, h0] : [o0, o1]
  let segB: [number, number] = hasHole ? [h1, o1] : [0, -1]

  // Обрезка по вертикальной оболочке |y| <= 12H (за ней плотность пренебрежима)
  const slabHalf = params.H * 12
  if (Math.abs(dir.y) > 1e-8) {
    const tA = (-slabHalf - origin.y) / dir.y
    const tB = (slabHalf - origin.y) / dir.y
    const s0 = Math.min(tA, tB)
    const s1 = Math.max(tA, tB)
    segA = [Math.max(segA[0], s0), Math.min(segA[1], s1)]
    segB = [Math.max(segB[0], s0), Math.min(segB[1], s1)]
  }

  const lenA = Math.max(segA[1] - segA[0], 0)
  const lenB = Math.max(segB[1] - segB[0], 0)
  const total = lenA + lenB
  if (total <= 0) return 0

  const dt = total / opts.steps
  let tau = 0
  const p = new Vector3()
  for (let i = 0; i < opts.steps; i++) {
    const s = (i + opts.jitter) * dt
    const t = s < lenA ? segA[0] + s : segB[0] + (s - lenA)
    p.copy(dir).multiplyScalar(t).add(origin)
    tau += densityAt(p, params) * nearRamp(t, opts.nearFade) * dt
    // early-exit: насыщение непрозрачности (зеркало GLSL)
    if (1 - Math.exp(-tau) > 0.995) break
  }
  return tau
}

/** Нечётная первообразная exp(-|u|/H): F(u) = sign(u) * H * (1 - exp(-|u|/H)) (зеркало ringDustF) */
const verticalAntiderivative = (u: number, H: number): number => {
  const f = H * (1 - Math.exp(-Math.abs(u) / H))
  return u >= 0 ? f : -f
}

/**
 * Замкнутая форма integral exp(-|y(t)|/H) dt по [t0, t1], y(t) = oy + dy*t
 * (зеркало ringDustVerticalIntegral)
 */
const verticalIntegral = (oy: number, dy: number, t0: number, t1: number, H: number): number => {
  if (t1 <= t0) return 0
  if (Math.abs(dy) < 1e-8) {
    return Math.exp(-Math.abs(oy) / H) * (t1 - t0)
  }
  const ya = oy + dy * t0
  const yb = oy + dy * t1
  const lo = Math.min(ya, yb)
  const hi = Math.max(ya, yb)
  return (verticalAntiderivative(hi, H) - verticalAntiderivative(lo, H)) / Math.abs(dy)
}

/**
 * Интервал параметра t, на котором луч (в проекции XZ) находится внутри
 * цилиндра радиуса R (зеркало ringDustCircleInterval).
 * Пустой интервал кодируется как [1, 0] (t0 > t1).
 */
const circleInterval = (origin: Vector3, dir: Vector3, R: number): [number, number] => {
  const a = dir.x * dir.x + dir.z * dir.z
  if (a < 1e-12) {
    // Вертикальный луч: внутри цилиндра целиком либо никогда
    const r = Math.hypot(origin.x, origin.z)
    return r <= R ? [-BIG, BIG] : [...EMPTY]
  }
  const b = origin.x * dir.x + origin.z * dir.z
  const c = origin.x * origin.x + origin.z * origin.z - R * R
  const disc = b * b - a * c
  if (disc <= 0) return [...EMPTY]
  const sq = Math.sqrt(disc)
  return [(-b - sq) / a, (-b + sq) / a]
}

/**
 * Средняя маска кромок по куску [t0, t1] с монотонным |y(t)|
 * (зеркало ringDustPieceMask).
 *
 * Тапы размещаются по квантилям экспоненциальной массы exp(-|y|/H) вдоль
 * куска (важностная выборка): маска сэмплируется там, где сосредоточен
 * вклад в интеграл, поэтому корреляция «пересечение средней плоскости в
 * зоне кромки» учитывается честно.
 */
const QUANTILES = [0.125, 0.375, 0.625, 0.875]

const pieceMask = (origin: Vector3, dir: Vector3, t0: number, t1: number, p: DustParams): number => {
  const L = t1 - t0
  const ya = Math.abs(origin.y + dir.y * t0)
  const yb = Math.abs(origin.y + dir.y * t1)
  // Масса концентрируется у конца с меньшим |y|
  const fromStart = ya <= yb
  const tNear = fromStart ? t0 : t1
  const sign = fromStart ? 1 : -1

  const absDy = Math.abs(dir.y)
  let sum = 0
  if (absDy < 1e-8) {
    // Равномерная масса — тапы по равномерным квантилям
    for (const q of QUANTILES) {
      const t = t0 + L * q
      sum += radialMask(Math.hypot(origin.x + dir.x * t, origin.z + dir.z * t), p)
    }
  } else {
    const lambda = p.H / absDy
    const A = Math.max(1 - Math.exp(-L / lambda), 1e-6)
    for (const q of QUANTILES) {
      const d = -lambda * Math.log(1 - q * A)
      const t = tNear + sign * Math.min(d, L)
      sum += radialMask(Math.hypot(origin.x + dir.x * t, origin.z + dir.z * t), p)
    }
  }
  return sum * 0.25
}

/** Вклад одного радиального интервала [t0, t1] в tau (зеркало ringDustIntervalTau) */
const intervalTau = (origin: Vector3, dir: Vector3, t0: number, t1: number, p: DustParams): number => {
  if (t1 <= t0) return 0

  // Разрез по пересечению средней плоскости: в каждом куске |y| монотонно,
  // что нужно и замкнутой форме, и квантильному размещению тапов маски
  let tCross = -1
  if (Math.abs(dir.y) >= 1e-8) {
    tCross = -origin.y / dir.y
  }

  let tau = 0
  if (tCross > t0 && tCross < t1) {
    tau += p.rho0 * pieceMask(origin, dir, t0, tCross, p) * verticalIntegral(origin.y, dir.y, t0, tCross, p.H)
    tau += p.rho0 * pieceMask(origin, dir, tCross, t1, p) * verticalIntegral(origin.y, dir.y, tCross, t1, p.H)
  } else {
    tau = p.rho0 * pieceMask(origin, dir, t0, t1, p) * verticalIntegral(origin.y, dir.y, t0, t1, p.H)
  }
  return tau
}

/**
 * Оптическая толща вдоль луча origin + dir*t, t in [0, tMax]
 * (зеркало ringDustTauRay). dir обязан быть нормирован.
 */
const tauRay = (origin: Vector3, dir: Vector3, tMax: number, p: DustParams): TauResult => {
  // Радиальный интервал внешнего цилиндра, обрезанный по [0, tMax]
  const outer = circleInterval(origin, dir, p.rOut)
  const o0 = Math.max(outer[0], 0)
  const o1 = Math.min(outer[1], tMax)
  if (o1 <= o0) return { tau: 0, span: [0, 0] }

  // Дыра кольца: интервал внутреннего цилиндра вычитается
  const inner = circleInterval(origin, dir, p.rIn)
  const h0 = Math.max(inner[0], o0)
  const h1 = Math.min(inner[1], o1)

  let tau = 0
  if (h1 <= h0) {
    // Дыру не пересекаем — один интервал
    tau = intervalTau(origin, dir, o0, o1, p)
  } else {
    tau = intervalTau(origin, dir, o0, h0, p) + intervalTau(origin, dir, h1, o1, p)
  }

  return { tau, span: [o0, o1] }
}

export { radialMask, verticalAntiderivative, verticalIntegral, circleInterval, tauRay, densityAt, angleGate, nearRamp, tauMarch }
export type { DustParams, TauResult, MarchOptions }
