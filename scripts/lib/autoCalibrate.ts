export interface CalibrationResult {
  amplitudeMeters: number
  rmsTan: number
  clamped: boolean
  iterations: number
}

/** Больше прогонов не берём — колбэк дорогой (полный синтез карты высот + slope). */
const MAX_ITERATIONS = 3
/** Допуск попадания в target: |rms−target|/target. */
const TOLERANCE = 0.1

/** Амплитуда, поджатая под потолок бюджета высоты, и флаг «поджата». */
function clampAmplitude(candidateMeters: number, maxHeightBudgetMeters: number): { amplitudeMeters: number; clamped: boolean } {
  return candidateMeters > maxHeightBudgetMeters
    ? { amplitudeMeters: maxHeightBudgetMeters, clamped: true }
    : { amplitudeMeters: candidateMeters, clamped: false }
}

/**
 * Автокалибровка амплитуды bump-полосы под целевой RMS(tan) итоговой
 * slope-карты: линейная подгонка `amplitude ← amplitude·(target/rms)` (на
 * откалиброванных телах движка — Каллисто/Европа — RMS(tan) практически
 * линеен по амплитуде в рабочем диапазоне), до `MAX_ITERATIONS` прогонов.
 * `generate` — весь дорогой конвейер (синтез поля высот → нормировка →
 * slope-карта → замер RMS) снаружи; здесь только числа, чем и тестируется
 * на синтетике без файлового ввода-вывода.
 *
 * Кламп: амплитуда никогда не превышает `maxHeightBudgetMeters` (0.7%
 * радиуса тела) — проверяется и для стартовой `refAmplitudeMeters` (малые
 * тела: 3000 м может УЖЕ быть больше 0.7% радиуса), и для каждой подгонки.
 * `clamped=true` означает, что итоговая амплитуда — потолок бюджета, а не
 * решение подгонки; `rmsTan` при этом — честный замер НА потолке, не
 * искусственно притянутый к target. Итерации останавливаются раньше
 * `MAX_ITERATIONS`, если подгонка не меняет амплитуду (потолок уже
 * достигнут — повторный прогон дал бы тот же результат).
 */
export function autoCalibrateAmplitude(
  generate: (amplitudeMeters: number) => number,
  refAmplitudeMeters: number,
  targetRmsTan: number,
  maxHeightBudgetMeters: number
): CalibrationResult {
  let { amplitudeMeters: amplitude, clamped } = clampAmplitude(refAmplitudeMeters, maxHeightBudgetMeters)
  let rms = generate(amplitude)
  let iterations = 1

  while (iterations < MAX_ITERATIONS) {
    const relativeError = Math.abs(rms - targetRmsTan) / targetRmsTan
    if (relativeError <= TOLERANCE) break
    if (!(rms > 0)) break // нулевой/отрицательный замер — линейная подгонка неопределена

    const next = clampAmplitude(amplitude * (targetRmsTan / rms), maxHeightBudgetMeters)
    if (next.amplitudeMeters === amplitude) break // потолок уже достигнут, повтор не изменит результат

    amplitude = next.amplitudeMeters
    clamped = next.clamped
    rms = generate(amplitude)
    iterations++
  }

  return { amplitudeMeters: amplitude, rmsTan: rms, clamped, iterations }
}
