/**
 * Чистая численная логика замера уровня воды тела по корреляции диффуза с
 * картой высот (`scripts/measure-water-level.ts` — тонкая CLI-обвязка
 * поверх этого модуля: чтение файлов, сборка blueness/heightMeters, печать
 * отчёта). Три независимых блока: бимодальный порог (Otsu), ресемпл сетки
 * ближайшим соседом, счёт согласия классификатора (precision/recall/F1).
 */

export interface OtsuResult {
  threshold: number
  fractionAbove: number
}

/**
 * Otsu-порог на гистограмме целых значений в [−255, 255] (диапазон
 * `blueness = B − max(R,G)` 8-битного RGB): перебор порогов, максимизация
 * межклассовой дисперсии `w0·w1·(μ0−μ1)²` — бимодальное разделение без
 * ручной константы.
 *
 * Вырожденный вход (одна непустая корзина, второй класс изначально пуст) —
 * цикл ни разу не обновляет `bestBin` (верхний класс пустеет раньше первой
 * оценки дисперсии) и возвращает порог на левом крае диапазона (−255):
 * `fractionAbove` тогда равна 1 (все значения строго больше −255).
 *
 * Пустой промежуток между модами (гистограмма буквально бимодальна, ни
 * одного значения в разрыве) даёт одинаковую межклассовую дисперсию на
 * любом пороге внутри разрыва — строгое сравнение `>` в цикле оставляет
 * первый достигнутый максимум, то есть верхний край НИЖНЕЙ моды, а не
 * середину разрыва. На реальных гистограммах (без точных пустот) это не
 * проявляется — порог падает туда, где плотность физически минимальна.
 *
 * `fractionAbove` — доля `values`, СТРОГО больше порога.
 */
export function otsuThreshold(values: Int16Array): OtsuResult {
  const OFFSET = 255
  const BINS = 511 // -255..255
  const hist = new Uint32Array(BINS)
  for (let i = 0; i < values.length; i++) hist[values[i] + OFFSET]++

  const total = values.length
  let sumAll = 0
  for (let bin = 0; bin < BINS; bin++) sumAll += bin * hist[bin]

  let sumBelow = 0
  let weightBelow = 0
  let bestVariance = -Infinity
  let bestBin = 0

  for (let bin = 0; bin < BINS; bin++) {
    weightBelow += hist[bin]
    if (weightBelow === 0) continue
    const weightAbove = total - weightBelow
    if (weightAbove === 0) break

    sumBelow += bin * hist[bin]
    const meanBelow = sumBelow / weightBelow
    const meanAbove = (sumAll - sumBelow) / weightAbove
    const diff = meanBelow - meanAbove
    const variance = weightBelow * weightAbove * diff * diff

    if (variance > bestVariance) {
      bestVariance = variance
      bestBin = bin
    }
  }

  const threshold = bestBin - OFFSET
  let above = 0
  for (let i = 0; i < values.length; i++) if (values[i] > threshold) above++

  return { threshold, fractionAbove: above / total }
}

/**
 * Ближайший сосед `src[u,v]` в сетке `dstWidth×dstHeight` — полутекселные
 * центры (та же конвенция, что у TEHM/диффуза): `u=(x+0.5)/width`.
 * Совпадающие размеры — identity-копия без пересэмпла (не alias исходного
 * буфера: правки результата не должны трогать вход).
 */
export function resampleNearest(
  src: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  srcChannels: number,
  dstWidth: number,
  dstHeight: number
): Uint8Array {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return Uint8Array.from(src)

  const out = new Uint8Array(dstWidth * dstHeight * srcChannels)
  for (let y = 0; y < dstHeight; y++) {
    const v = (y + 0.5) / dstHeight
    const sy = Math.min(srcHeight - 1, Math.floor(v * srcHeight))
    for (let x = 0; x < dstWidth; x++) {
      const u = (x + 0.5) / dstWidth
      const sx = Math.min(srcWidth - 1, Math.floor(u * srcWidth))
      const srcIndex = (sy * srcWidth + sx) * srcChannels
      const dstIndex = (y * dstWidth + x) * srcChannels
      for (let c = 0; c < srcChannels; c++) out[dstIndex + c] = src[srcIndex + c]
    }
  }

  return out
}

export interface ConfusionCounts {
  tp: number
  fp: number
  fn: number
}

/** tp/fp/fn между двумя масками 0/1 одинаковой длины (`predicted`, `actual`) — tn не считается, F1 её не использует. */
export function confusionCounts(predicted: ArrayLike<number>, actual: ArrayLike<number>): ConfusionCounts {
  let tp = 0
  let fp = 0
  let fn = 0

  for (let i = 0; i < predicted.length; i++) {
    const p = predicted[i] !== 0
    const a = actual[i] !== 0
    if (p && a) tp++
    else if (p && !a) fp++
    else if (!p && a) fn++
  }

  return { tp, fp, fn }
}

export interface PrecisionRecallF1 {
  precision: number
  recall: number
  f1: number
}

/**
 * precision/recall/F1 из счётчиков. Пустой знаменатель (`tp+fp=0` или
 * `tp+fn=0`) даёт 0, не NaN — «нет предсказаний» или «нет фактов»
 * трактуется как несогласие классификатора, не как идеальное совпадение по
 * пустому множеству.
 */
export function precisionRecallF1(counts: ConfusionCounts): PrecisionRecallF1 {
  const { tp, fp, fn } = counts
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  return { precision, recall, f1 }
}
