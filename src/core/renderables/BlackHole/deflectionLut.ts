import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat } from 'three'

/**
 * LUT угла отклонения луча в зоне симуляции ЧД (этап 4 спецификации).
 *
 * Печётся дословным CPU-портом интегратора Бине из BlackHoleShaderTemplate
 * (velocity Verlet, u'' = −u + 1.5·u², те же MAX_STEPS и PHI_MAX) и ТЕМ ЖЕ
 * dphi, что живёт в конфиге: LUT обязан совпадать с живым интегратором на
 * стыке ветвей, ВКЛЮЧАЯ его погрешности, — печь точнее значило бы вернуть
 * шов, ради устранения которого LUT и заведён.
 *
 * Домен — прицельный параметр b ∈ [DEFLECTION_LUT_B_MIN, simulationRs],
 * отсчёты в центрах текселей. Значение — угол (рад) между конечным и
 * начальным направлением луча, накопленный ВНУТРИ зоны: на краю зоны хорда
 * нулевая, α = 0, и непрерывность с нелензированным фоном вне меша
 * автоматическая, без окон и кроссфейдов.
 */

export const DEFLECTION_LUT_SIZE: number = 256

/** Нижняя граница домена = граница LUT-ветки в шейдере (WEAK_FIELD_B) */
export const DEFLECTION_LUT_B_MIN: number = 8.0

/** Страховка от бесконечного цикла — тот же потолок, что MAX_STEPS шейдера */
const MAX_STEPS: number = 256
/** Предел навивки — тот же, что PHI_MAX шейдера (3π) */
const PHI_MAX: number = 9.42477796

/**
 * Угол отклонения одного луча: вход в зону на радиусе simulationRs с
 * прицельным параметром b, интегрирование в плоскости геодезической до выхода
 */
function deflectionAngle(b: number, simulationRs: number, dphi: number): number {
  const r0: number = simulationRs

  // Начальные условия Бине: у единичного направления тангенциальная
  // компонента b/r0, радиальная — внутрь (луч входит в зону)
  const tangential: number = b / r0
  const radial: number = -Math.sqrt(Math.max(1 - tangential * tangential, 0))

  let u: number = 1 / r0
  let du: number = -radial / (r0 * tangential)
  let phi: number = 0

  // плоскость геодезической: x — вдоль e1 (радиус входа), y — вдоль e2
  let prevX: number = r0
  let prevY: number = 0
  let posX: number = prevX
  let posY: number = prevY

  for (let step = 0; step < MAX_STEPS; step++) {
    if (phi > PHI_MAX) break

    const a0: number = -u + 1.5 * u * u
    const u1: number = u + du * dphi + 0.5 * a0 * dphi * dphi
    const a1: number = -u1 + 1.5 * u1 * u1
    du += 0.5 * (a0 + a1) * dphi
    u = u1
    phi += dphi

    if (u > 1.0) break
    u = Math.max(u, 1e-5)

    const r: number = 1 / u
    posX = Math.cos(phi) * r
    posY = Math.sin(phi) * r

    if (r > simulationRs && posX * posX + posY * posY > prevX * prevX + prevY * prevY) break

    prevX = posX
    prevY = posY
  }

  // Конечное направление — последний шаг; начальное — (radial, tangential).
  // На домене b ≥ 8 захвата и полной навивки не бывает (критический b ≈ 2.6),
  // поэтому цикл всегда завершается выходом из зоны
  const dirX: number = posX - prevX
  const dirY: number = posY - prevY
  const cross: number = radial * dirY - tangential * dirX
  const dot: number = radial * dirX + tangential * dirY

  return Math.abs(Math.atan2(cross, dot))
}

export function bakeDeflectionAngles(simulationRs: number, dphi: number): Float32Array {
  const angles = new Float32Array(DEFLECTION_LUT_SIZE)

  // Вырожденная зона (кастомный simulationRadius меньше границы слабого
  // поля): LUT-ветка в шейдере недостижима (b ≤ simulationRs < B_MIN),
  // таблица не читается — нули честнее мусора
  if (simulationRs <= DEFLECTION_LUT_B_MIN) return angles

  for (let i = 0; i < DEFLECTION_LUT_SIZE; i++) {
    const b: number =
      DEFLECTION_LUT_B_MIN + ((i + 0.5) / DEFLECTION_LUT_SIZE) * (simulationRs - DEFLECTION_LUT_B_MIN)
    angles[i] = deflectionAngle(b, simulationRs, dphi)
  }

  return angles
}

export function createDeflectionLutTexture(simulationRs: number, dphi: number): DataTexture {
  const angles: Float32Array = bakeDeflectionAngles(simulationRs, dphi)
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
  texture.name = 'BlackHole.DeflectionLut'

  return texture
}
