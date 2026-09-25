import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat } from 'three'

/**
 * Таблицы отклонения луча для шейдера ЧД (единицы rs = 1, углы в радианах).
 *
 * DeflectionLut (LUT-ветка, b ≥ WEAK_FIELD_B): ПОЛНОЕ отклонение луча с
 * прицельным параметром b — интегратор Бине стартует далеко за зоной
 * (LUT_FAR_START_RS) и там же выходит. Внутри зоны шейдер применяет его
 * целиком, снаружи меша кадр сдвигает GravitationalLensEffect по ряду
 * farFieldDeflection — на кромке оба сходятся, поле сдвига гладкое.
 *
 * OutsideLut (геодезическая ветка): δ(b) = полное − хорда, где хорда — ровно
 * то, что набирает живой интегратор шейдера от кромки до кромки (зеркало
 * chordDeflectionAngle, включая секущую последнего шага). Прибавляется к
 * уходящему направлению при побеге: на общей границе ветвей суммы совпадают
 * по построению.
 *
 * Вход в зону: плоское направление отрезка «камера → сфера» перецеливается в
 * локальное направление луча с тем же b: sin θ_loc = (b/r)·√(1 − rs/r), и в
 * условии Бине u′ = cot θ_loc·√(1 − rs/r)/r. Без этого трассируется луч с
 * b на 1.9 % больше на кромке 27 rs. Та же строка живёт в шейдере.
 *
 * Сетка обеих таблиц — на КРАЯХ домена (узел i ↔ t = i/(N−1)): ClampToEdge +
 * LinearFilter делают выборку плоской на внешних полутекселях, и сетка по
 * краям кладёт эти участки мимо стыков ветвей.
 */

export const DEFLECTION_LUT_SIZE: number = 256

/** Нижняя граница домена DeflectionLut = граница LUT-ветки в шейдере (WEAK_FIELD_B) */
export const DEFLECTION_LUT_B_MIN: number = 8.0

/** Старт интегратора полного отклонения, rs: остаток за ним ~ b/R² < 3e-7 рад */
export const LUT_FAR_START_RS: number = 1e4

/** Прицельный параметр захвата, rs: √27/2. Ниже луч не выходит, δ = 0 */
const CAPTURE_B: number = Math.sqrt(27) / 2

/** Потолок шагов живого интегратора шейдера (MAX_STEPS) — для зеркала хорды */
const CHORD_MAX_STEPS: number = 256
/** Предел навивки живого интегратора — тот же, что PHI_MAX шейдера (3π) */
const PHI_MAX: number = 9.42477796
/** Печка полного отклонения: шаг мельче живого в BAKE_DPHI_DIVISOR раз, путь длиннее */
const BAKE_DPHI_DIVISOR: number = 10
const TOTAL_MAX_STEPS: number = 4096 * BAKE_DPHI_DIVISOR

/**
 * Ряд дальнего поля Шварцшильда, b в rs: 2/b + (15π/16)/b² + (16/3)/b³.
 * На b = 27 расходится с интегратором на ~2e-5 рад; зеркало GLSL в
 * GravitationalLensEffect
 */
export function farFieldDeflection(bRs: number): number {
  const b2 = bRs * bRs
  return 2 / bRs + (15 * Math.PI) / 16 / b2 + 16 / 3 / (b2 * bRs)
}

/** √(1 − rs/r): связь локального угла статического наблюдателя с координатами */
function aimFactor(r: number): number {
  return Math.sqrt(1 - 1 / r)
}

interface BinetState {
  u: number
  du: number
  phi: number
}

/**
 * Начальное состояние луча с прицельным параметром b, входящего в сферу
 * радиуса r0. Плоская тангенциальная компонента t = b/r0 перецеливается в
 * локальную t·√(1 − 1/r0); в сумме u′ = √(1 − t²(1 − 1/r0)) / (t·r0)
 */
function entryState(b: number, r0: number): BinetState {
  const t: number = b / r0
  const f: number = aimFactor(r0)
  return { u: 1 / r0, du: Math.sqrt(Math.max(1 - t * t * f * f, 0)) / (t * r0), phi: 0 }
}

/** Угол плоского входного направления в плоскости (e1 — радиус входа, e2 — вдоль φ) */
function entryAngle(b: number, r0: number): number {
  const t: number = b / r0
  return Math.atan2(t, -Math.sqrt(Math.max(1 - t * t, 0)))
}

function verletStep(s: BinetState, dphi: number): BinetState {
  const a0: number = -s.u + 1.5 * s.u * s.u
  const u1: number = s.u + s.du * dphi + 0.5 * a0 * dphi * dphi
  const a1: number = -u1 + 1.5 * u1 * u1
  return { u: u1, du: s.du + 0.5 * (a0 + a1) * dphi, phi: s.phi + dphi }
}

/**
 * Угол координатной касательной луча в плоскости: вектор dr/dφ·r̂ + r·φ̂ при
 * r̂ под углом φ. Монотонен по φ — не сворачивается на навивке
 */
function tangentAngle(s: BinetState): number {
  const r: number = 1 / s.u
  const drdphi: number = -s.du / (s.u * s.u)
  return s.phi + Math.atan2(r, drdphi)
}

/** Ближайший к reference представитель угла angle по модулю 2π */
function unwrapNear(angle: number, reference: number): number {
  return angle + 2 * Math.PI * Math.round((reference - angle) / (2 * Math.PI))
}

/**
 * Отклонение ХОРДЫ внутри сферы simulationRs — дословное зеркало живого
 * интегратора шейдера: тот же старт с кромки (с перецеливанием), тот же шаг
 * и потолки, секущая последнего шага как уходящее направление. Нужно печке
 * δ(b) и тестам паритета на стыке ветвей. Захват — NaN
 */
export function chordDeflectionAngle(b: number, simulationRs: number, dphi: number): number {
  let s: BinetState = entryState(b, simulationRs)
  let prev: BinetState = s
  let prevR2: number = simulationRs * simulationRs

  for (let step = 0; step < CHORD_MAX_STEPS; step++) {
    if (s.phi > PHI_MAX) return NaN
    prev = s
    s = verletStep(s, dphi)
    if (s.u > 1.0) return NaN
    s = { ...s, u: Math.max(s.u, 1e-5) }

    const r: number = 1 / s.u
    if (r > simulationRs && r * r > prevR2) {
      const rp: number = 1 / prev.u
      const dx: number = Math.cos(s.phi) * r - Math.cos(prev.phi) * rp
      const dy: number = Math.sin(s.phi) * r - Math.sin(prev.phi) * rp
      const secant: number = unwrapNear(Math.atan2(dy, dx), tangentAngle(s))
      return secant - entryAngle(b, simulationRs)
    }
    prevR2 = r * r
  }

  return NaN
}

/**
 * Полное отклонение луча с прицельным параметром b: старт и выход на
 * LUT_FAR_START_RS, мелкий шаг, касательная из состояния, интерполированного
 * к радиусу выхода. Захват — NaN
 */
function totalDeflectionAngle(b: number, dphi: number): number {
  const r0: number = LUT_FAR_START_RS
  const step: number = dphi / BAKE_DPHI_DIVISOR
  const uExit: number = 1 / r0
  let s: BinetState = entryState(b, r0)

  for (let i = 0; i < TOTAL_MAX_STEPS; i++) {
    const next: BinetState = verletStep(s, step)
    // Выход: на нисходящей ветви u проходит через 1/r0 (за один шаг φ у
    // кромки u может перескочить и через ноль — проверка до клампа)
    if (next.du < 0 && next.u <= uExit && i > 0) {
      const f: number = (s.u - uExit) / (s.u - next.u)
      const exit: BinetState = { u: uExit, du: s.du + f * (next.du - s.du), phi: s.phi + f * step }
      return tangentAngle(exit) - entryAngle(b, r0)
    }
    if (next.u > 1.0) return NaN
    s = { ...next, u: Math.max(next.u, 1e-6) }
  }

  return NaN
}

/**
 * Наружная добавка δ(b) = полное отклонение − хорда живого интегратора.
 * Ниже захвата и там, где хорда не выходит из сферы, — 0
 */
export function outsideDeflection(bRs: number, simulationRs: number, dphi: number): number {
  if (bRs <= CAPTURE_B) return 0
  const total: number = totalDeflectionAngle(bRs, dphi)
  const chord: number = chordDeflectionAngle(bRs, simulationRs, dphi)
  if (!Number.isFinite(total) || !Number.isFinite(chord)) return 0
  return total - chord
}

export function bakeDeflectionAngles(simulationRs: number, dphi: number): Float32Array {
  const angles = new Float32Array(DEFLECTION_LUT_SIZE)

  // Вырожденная зона (кастомный simulationRadius меньше границы слабого
  // поля): LUT-ветка в шейдере недостижима (b ≤ simulationRs < B_MIN),
  // таблица не читается — нули честнее мусора
  if (simulationRs <= DEFLECTION_LUT_B_MIN) return angles

  for (let i = 0; i < DEFLECTION_LUT_SIZE; i++) {
    const b: number =
      DEFLECTION_LUT_B_MIN + (i / (DEFLECTION_LUT_SIZE - 1)) * (simulationRs - DEFLECTION_LUT_B_MIN)
    angles[i] = totalDeflectionAngle(b, dphi)
  }

  return angles
}

/** Таблица δ(b) для геодезической ветки: домен b ∈ [0, simulationRs], узел i ↔ b = i/(N−1)·R */
export function bakeOutsideAngles(simulationRs: number, dphi: number): Float32Array {
  const angles = new Float32Array(DEFLECTION_LUT_SIZE)
  for (let i = 0; i < DEFLECTION_LUT_SIZE; i++) {
    angles[i] = outsideDeflection((i / (DEFLECTION_LUT_SIZE - 1)) * simulationRs, simulationRs, dphi)
  }
  return angles
}

function toLutTexture(angles: Float32Array, name: string): DataTexture {
  const half = new Uint16Array(DEFLECTION_LUT_SIZE)
  for (let i = 0; i < DEFLECTION_LUT_SIZE; i++) half[i] = DataUtils.toHalfFloat(angles[i])

  // R16F: фильтруемость half-float — ядро WebGL2 (у R32F она за расширением)
  const texture = new DataTexture(half, DEFLECTION_LUT_SIZE, 1, RedFormat, HalfFloatType)
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  texture.name = name
  return texture
}

export function createDeflectionLutTexture(simulationRs: number, dphi: number): DataTexture {
  return toLutTexture(bakeDeflectionAngles(simulationRs, dphi), 'BlackHole.DeflectionLut')
}

export function createOutsideLutTexture(simulationRs: number, dphi: number): DataTexture {
  return toLutTexture(bakeOutsideAngles(simulationRs, dphi), 'BlackHole.OutsideLut')
}
