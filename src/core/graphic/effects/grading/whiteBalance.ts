import { Vector3 } from 'three'

/** Температура опорного света: на ней баланс белого тождественен */
export const REFERENCE_TEMPERATURE_K: number = 6500

// Яркостные веса Rec.709 — те же, что у luminance в прологе three
const LUMINANCE_WEIGHTS: Vector3 = new Vector3(0.2126, 0.7152, 0.0722)

// Kim et al. заявляют формулу валидной для 1667–25000 K. Верхнюю границу
// расширили до 40000 K — проверено численно, множитель там остаётся в
// разумной полосе. Нижнюю пришлось поднять до 2000 K (совпадает с минимумом
// слайдера температуры в Lightroom/Camera Raw): ниже точка локуса выходит за
// охват sRGB, целевой канал уходит в 0 даже после приведения в охват, и
// множитель бы неограниченно рос вплоть до 1667 K включительно — см. gamutClip
const MIN_TEMPERATURE_K: number = 2000
const MAX_TEMPERATURE_K: number = 40000

// Сила ручки тинта: доля, на которую меняется зелёный канал на краю диапазона.
// На tint = ±1 множитель зелёного до нормировки — 1.2 и 0.8
const TINT_STRENGTH: number = 0.2

/**
 * Координаты цветности xy точки планковского локуса для заданной температуры.
 * Кусочное кубическое приближение (Kim et al.) — то же, что используют
 * движковые реализации белого баланса.
 */
function planckianChromaticity(temperatureK: number): { x: number; y: number } {
  const t: number = Math.min(Math.max(temperatureK, MIN_TEMPERATURE_K), MAX_TEMPERATURE_K)
  const kilo: number = t * 1e-3
  const kilo2: number = kilo * kilo
  const kilo3: number = kilo2 * kilo

  // Коэффициенты приведены к kilo-Kelvin: степени 10^9/10^6/10^3 из исходной
  // формулы (T в кельвинах) уже поглощены переходом T = kilo·1000
  const x: number =
    t < 4000
      ? -0.2661239 / kilo3 - 0.2343589 / kilo2 + 0.8776956 / kilo + 0.17991
      : -3.0258469 / kilo3 + 2.1070379 / kilo2 + 0.2226347 / kilo + 0.24039

  const x2: number = x * x
  const x3: number = x2 * x

  const y: number =
    t < 2222
      ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
      : t < 4000
        ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483

  return { x, y }
}

/** Цветность xy → линейный sRGB при единичной яркости */
function linearSrgbFromChromaticity(x: number, y: number): Vector3 {
  const safeY: number = Math.max(y, 1e-6)
  const bigX: number = x / safeY
  const bigY: number = 1
  const bigZ: number = (1 - x - y) / safeY

  return new Vector3(
    3.2404542 * bigX - 1.5371385 * bigY - 0.4985314 * bigZ,
    -0.969266 * bigX + 1.8760108 * bigY + 0.041556 * bigZ,
    0.0556434 * bigX - 0.2040259 * bigY + 1.0572252 * bigZ
  )
}

/**
 * Приведение цвета в ОХВАТ (gamut) sRGB десатурацией к белому: если
 * минимальный канал отрицателен, его модуль добавляется ко всем трём — цвет
 * становится представимым, оттенок сохраняется. Не зажатие отрицательного
 * канала в ноль: то теряет цвет, это — сдвигает координату
 */
function gamutClip(rgb: Vector3): Vector3 {
  const minChannel: number = Math.min(rgb.x, rgb.y, rgb.z)

  return minChannel < 0 ? new Vector3(rgb.x, rgb.y, rgb.z).addScalar(-minChannel) : rgb
}

/** Множитель экспозиции: ручка в стопах, один стоп — вдвое */
export function exposureGain(stops: number): number {
  return Math.pow(2, stops)
}

/**
 * Поканальный множитель баланса белого.
 *
 * `temperatureK` — температура ОПОРНОГО СВЕТА, а не картинки: ниже опорной
 * кадр становится холоднее, выше — теплее. `tint` в диапазоне −1…1 двигает
 * зелёный против пурпурного; это упрощение, а не колориметрический duv.
 *
 * Результат нормирован по яркости — за яркость отвечает только экспозиция.
 */
export function whiteBalanceGain(temperatureK: number, tint: number): Vector3 {
  const target: { x: number; y: number } = planckianChromaticity(temperatureK)
  const reference: { x: number; y: number } = planckianChromaticity(REFERENCE_TEMPERATURE_K)

  const targetRgb: Vector3 = gamutClip(linearSrgbFromChromaticity(target.x, target.y))
  const referenceRgb: Vector3 = gamutClip(linearSrgbFromChromaticity(reference.x, reference.y))

  const gain: Vector3 = new Vector3(
    referenceRgb.x / Math.max(targetRgb.x, 1e-6),
    referenceRgb.y / Math.max(targetRgb.y, 1e-6),
    referenceRgb.z / Math.max(targetRgb.z, 1e-6)
  )

  gain.y *= 1 + tint * TINT_STRENGTH

  return gain.divideScalar(Math.max(gain.dot(LUMINANCE_WEIGHTS), 1e-6))
}
