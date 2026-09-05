import type { MidbandEnvelope } from './midbandField'

export const ENVELOPE_GRID_WIDTH = 1024
export const ENVELOPE_GRID_HEIGHT = 512

/** Каналов на ячейку: [slopeTan, curvature, downE, downN] — см. докблок класса. */
const CHANNELS = 4

/**
 * Сетка огибающей средней полосы (арка B): уклон/кривизна/сток карты высот,
 * посчитанные ОДИН раз при постройке `TerrainHeightField`, а не за вызов
 * `heightMeters`. Разрешение сетки (1024×512) ниже карты — огибающая полосы
 * следует общей форме рельефа (склон/кромка), не текселю, поэтому дешёвая
 * фиксированная сетка достаточна для любой карты.
 *
 * Единицы: `slopeTan` — tan уклона карты (центральные разности, тот же
 * приём расширения окна к полюсу 1/cosLat, что и `surfaceNormalLocal`/
 * `buildClearanceGrid` в TerrainHeightField); `curvature` — нормированная p99
 * по ВСЕЙ сетке и клампнутая в [-1, 1] (+ выпуклость/кромка, − вогнутость/яма);
 * `downE`/`downN` — ЕДИНИЧНЫЙ вектор стока в базисе восток/север, (1, 0) на
 * плоском участке (уклон 0 — сток не определён). Билинейная интерполяция
 * выпуклой комбинации единичных векторов по построению не превышает единицу
 * (|Σwᵢvᵢ| ≤ Σwᵢ|vᵢ| = 1) — отдельной ренормализации на чтении не нужно,
 * бонд MidbandField на |w| ≤ 1 держится сам.
 *
 * ЛОВУШКА: север карты — УБЫВАЮЩИЙ v (конвенция всего класса
 * TerrainHeightField), поэтому север берётся из (v − dv), а не (v + dv).
 */
export class MidbandEnvelopeGrid {
  private readonly data: Float32Array

  public constructor(
    sampleMeters: (u: number, v: number) => number,
    mapWidth: number,
    mapHeight: number,
    radiusMeters: number
  ) {
    const w = ENVELOPE_GRID_WIDTH
    const h = ENVELOPE_GRID_HEIGHT
    const data = new Float32Array(w * h * CHANNELS)
    const curvatureRaw = new Float32Array(w * h)
    const texelArcN = (Math.PI * radiusMeters) / mapHeight
    const dv = 1 / mapHeight
    // Лапласиан — на ОДНОТЕКСЕЛЬНОМ шаге по долготе, не на расширенном к
    // полюсу окне уклона (см. `du`/`span` ниже): широкий одноразовый
    // центральный дифференс на периодическом рельефе у полюса задевает
    // противофазную точку сигнала и алиасится — лапласиан там становится
    // немонотонным шумом вместо честной кромки/ямы (страж —
    // midbandEnvelopeGrid.spec, кейс «кромка/яма» на полюсе). По широте шаг
    // везде однотекселен (`dv`) — сюда расширение и не заходило.
    const duFixed = 1 / mapWidth

    for (let row = 0; row < h; row++) {
      const v = (row + 0.5) / h
      const cosLat = Math.sin(Math.PI * v)
      // та же идиома расширения окна к полюсу, что у surfaceNormalLocal —
      // ТОЛЬКО для уклона (кривизна берёт фиксированный duFixed выше)
      const span = Math.max(1, Math.min(mapWidth / 4, Math.round(1 / Math.max(cosLat, 1e-9))))
      const du = span / mapWidth
      const texelArcE = (2 * Math.PI * radiusMeters * cosLat) / mapWidth

      for (let col = 0; col < w; col++) {
        const u = (col + 0.5) / w
        const center = sampleMeters(u, v)
        const east1 = sampleMeters(u + du, v)
        const east0 = sampleMeters(u - du, v)
        const north1 = sampleMeters(u, v - dv) // север = убывающий v
        const north0 = sampleMeters(u, v + dv)

        const gE = (east1 - east0) / (2 * span * texelArcE)
        const gN = (north1 - north0) / (2 * texelArcN)
        const slopeTan = Math.hypot(gE, gN)

        // лапласиан на однотекселном шаге (см. duFixed) — не на span'е
        // уклона; выпуклость (кромка) — h выше соседей — lap < 0 ⇒ curvatureRaw > 0
        const eastCurv1 = du === duFixed ? east1 : sampleMeters(u + duFixed, v)
        const eastCurv0 = du === duFixed ? east0 : sampleMeters(u - duFixed, v)
        const lap = (eastCurv1 + eastCurv0 + north1 + north0 - 4 * center) / (texelArcN * texelArcN)
        const idx = row * w + col
        curvatureRaw[idx] = -lap

        const base = idx * CHANNELS
        data[base] = slopeTan
        if (slopeTan > 0) {
          data[base + 2] = -gE / slopeTan
          data[base + 3] = -gN / slopeTan
        } else {
          data[base + 2] = 1 // сток не определён — фиксированное направление-заглушка
          data[base + 3] = 0
        }
      }
    }

    // нормировка кривизны — второй проход, p99 нужен по всей сетке целиком
    const p99 = percentile99Abs(curvatureRaw)
    for (let idx = 0; idx < w * h; idx++) {
      const normalized = p99 > 0 ? curvatureRaw[idx] / p99 : 0
      data[idx * CHANNELS + 1] = Math.min(1, Math.max(-1, normalized))
    }

    this.data = data
  }

  /** Билинейная выборка на полутекселях сетки: wrap по u (шов меридиана), кламп по v (полюса) — как sampleMeters. */
  public sample(u: number, v: number, out: MidbandEnvelope): MidbandEnvelope {
    const w = ENVELOPE_GRID_WIDTH
    const h = ENVELOPE_GRID_HEIGHT
    const data = this.data

    let x = (u - Math.floor(u)) * w - 0.5
    if (x < 0) x += w
    const x0 = Math.min(Math.floor(x), w - 1)
    const x1 = (x0 + 1) % w
    const fx = x - x0

    const y = Math.min(Math.max(Math.min(Math.max(v, 0), 1) * h - 0.5, 0), h - 1)
    const y0 = Math.floor(y)
    const y1 = Math.min(y0 + 1, h - 1)
    const fy = y - y0

    const i00 = (y0 * w + x0) * CHANNELS
    const i10 = (y0 * w + x1) * CHANNELS
    const i01 = (y1 * w + x0) * CHANNELS
    const i11 = (y1 * w + x1) * CHANNELS

    out.slopeTan = bilerpChannel(data, i00, i10, i01, i11, 0, fx, fy)
    out.curvature = bilerpChannel(data, i00, i10, i01, i11, 1, fx, fy)
    out.downE = bilerpChannel(data, i00, i10, i01, i11, 2, fx, fy)
    out.downN = bilerpChannel(data, i00, i10, i01, i11, 3, fx, fy)

    return out
  }
}

function bilerpChannel(
  data: Float32Array,
  i00: number,
  i10: number,
  i01: number,
  i11: number,
  channel: number,
  fx: number,
  fy: number
): number {
  const v00 = data[i00 + channel]
  const v10 = data[i10 + channel]
  const v01 = data[i01 + channel]
  const v11 = data[i11 + channel]

  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
}

/**
 * 99-й процентиль |значений|, гистограммная оценка (не сортировка): проход 1
 * находит max|v|, проход 2 раскладывает |v| по 1024 бинам на [0, max], проход
 * 3 копит счётчик с хвоста (наибольших бинов) до 1 % значений и возвращает
 * ВЕРХНЮЮ границу найденного бина — оценка ≥ истинного p99, ошибка вверх не
 * больше ширины бина (max/1024). Точная сортировка 524 288 элементов
 * (1024×512 сетки) стоила ≈ 65 мс на тело (замер) — три линейных прохода
 * дешевле на два порядка; страж на синусоидальной карте (midbandEnvelopeGrid.spec)
 * проверяет отклонение от сортировочного p99 (≤ 2 % от max|v|).
 */
export function percentile99Abs(values: Float32Array): number {
  let max = 0
  for (let i = 0; i < values.length; i++) {
    const v = Math.abs(values[i])
    if (v > max) max = v
  }
  if (max === 0) return 0

  const BINS = 1024
  const counts = new Uint32Array(BINS)
  const scale = BINS / max
  for (let i = 0; i < values.length; i++) {
    const v = Math.abs(values[i])
    const bin = Math.min(BINS - 1, Math.floor(v * scale))
    counts[bin]++
  }

  const tailTarget = 0.01 * values.length
  let cumulative = 0
  for (let bin = BINS - 1; bin >= 0; bin--) {
    cumulative += counts[bin]
    if (cumulative >= tailTarget) return ((bin + 1) / BINS) * max
  }

  return max
}
