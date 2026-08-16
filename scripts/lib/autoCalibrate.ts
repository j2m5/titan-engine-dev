export interface CalibrationResult {
  amplitudeMeters: number
  rmsTan: number
  peakMeters: number
  clamped: boolean
  iterations: number
}

/** Один прогон дорогого колбэка: RMS(tan) итоговой slope-карты и фактический пик поля высот. */
export interface CalibrationSample {
  rmsTan: number
  peakMeters: number
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
 * slope-карта → замер RMS и фактического пика) снаружи; здесь только числа,
 * чем и тестируется на синтетике без файлового ввода-вывода.
 *
 * Кламп ПАРАМЕТРА: амплитуда, которую подгоняет эта функция, никогда не
 * превышает `maxHeightBudgetMeters` — проверяется и для стартовой
 * `refAmplitudeMeters` (малые тела: 3000 м может УЖЕ быть больше 0.7%
 * радиуса), и для каждой подгонки. `clamped=true` означает, что итоговая
 * амплитуда — потолок бюджета, а не решение подгонки по RMS. Итерации
 * останавливаются раньше `MAX_ITERATIONS`, если подгонка не меняет амплитуду
 * (потолок уже достигнут — повторный прогон дал бы тот же результат).
 *
 * ВАЖНО (находка фикс-раунда 1): этот кламп ограничивает только ПАРАМЕТР
 * `amplitudeMeters`, а не фактический пик итогового поля высот — подложка
 * (`baseAmplitudeMeters` конвейера) в эту амплитуду не входит и эта функция
 * о ней ничего не знает. `peakMeters` в результате — честный пробрасываемый
 * замер пика ПОСЛЕДНЕГО прогона `generate` (может превышать
 * `maxHeightBudgetMeters`, даже когда `clamped=false` — амплитуда-параметр
 * была в рамках, но подложка+band-овершут вытолкнули реальный max|h| выше).
 * Рескейл по факту пика (затрагивает подложку — величину, которой эта
 * функция не управляет) — ответственность вызывающего кода, которому
 * известна вся композиция поля (см. `batch-synth-heightmaps.ts`).
 */
export function autoCalibrateAmplitude(
  generate: (amplitudeMeters: number) => CalibrationSample,
  refAmplitudeMeters: number,
  targetRmsTan: number,
  maxHeightBudgetMeters: number
): CalibrationResult {
  let { amplitudeMeters: amplitude, clamped } = clampAmplitude(refAmplitudeMeters, maxHeightBudgetMeters)
  let { rmsTan: rms, peakMeters: peak } = generate(amplitude)
  let iterations = 1

  while (iterations < MAX_ITERATIONS) {
    const relativeError = Math.abs(rms - targetRmsTan) / targetRmsTan
    if (relativeError <= TOLERANCE) break
    if (!(rms > 0)) break // нулевой/отрицательный замер — линейная подгонка неопределена

    const next = clampAmplitude(amplitude * (targetRmsTan / rms), maxHeightBudgetMeters)
    if (next.amplitudeMeters === amplitude) break // потолок уже достигнут, повтор не изменит результат

    amplitude = next.amplitudeMeters
    clamped = next.clamped
    const sample = generate(amplitude)
    rms = sample.rmsTan
    peak = sample.peakMeters
    iterations++
  }

  return { amplitudeMeters: amplitude, rmsTan: rms, peakMeters: peak, clamped, iterations }
}
