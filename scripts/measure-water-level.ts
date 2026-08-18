import process from 'node:process'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { argument } from './lib/cliArguments'

/**
 * Замер уровня воды тела по корреляции диффуза с картой высот — для тел без
 * DEM, где height синтезирован ИЗ ТОГО ЖЕ диффуза (see `batch-synth-heightmaps.ts`):
 * «тёмное/синее ↔ низкое» ожидается корреляцией синтеза, но знак (bump-sign)
 * не гарантирован, поэтому уровень воды не подобрать на глаз — замер выбирает
 * его максимизацией F1 между «водный тексель диффуза» и «h(тексель) < L» по
 * сетке уровней L.
 *
 * Классификация «водный тексель»: blueness = B − max(R,G) (насколько синий
 * канал выступает над самым ярким из R/G — устойчивее к белым облакам, у
 * которых R≈G≈B и blueness≈0, чем сырой B). Порог — Otsu на гистограмме
 * blueness (максимизация межклассовой дисперсии, см. `otsuThreshold`):
 * гистограмма таких composite-текстур типично бимодальна (пик суши/облаков
 * у blueness≈0, пик открытой воды у blueness≈20-30), Otsu находит седловину
 * между модами без ручного подбора константы.
 *
 * Сетка уровней L — перцентили высоты 5..95 с шагом 5 (19 точек): диапазон
 * высот тела заранее неизвестен (вымышленные тела), перцентили покрывают его
 * пропорционально независимо от абсолютных чисел.
 *
 * F1 по тексельной маске (не площади): решение «водный/нет» принимается на
 * уровне текселя, взвешивать по площади (cos широты) означало бы давать
 * приполярным текселям меньший голос в ИМЕННО этом классификаторе — площадь
 * пригодится дальше (доля воды на теле — метрика географии, не метрика
 * согласия классификатора с картой высот). Диффуз и height ресемплятся к
 * общей сетке ближайшим соседом (`resampleNearest`) — на Явине IV сетки
 * совпадают 1:1 (обе 4096×2048), но инструмент общий (Титан переиспользует
 * на других телах с иным разрешением диффуза).
 *
 * Запуск: npm run measure-water-level -- --diffuse <файл диффуза>
 *   --height <файл .raw TEHM> [--levels <перцентили через запятую, дефолт 5..95 шаг 5>]
 *
 * Явин IV: npm run measure-water-level -- \
 *   --diffuse storage/images/textures/planets/StarWars/yavin/iv/iv.png \
 *   --height storage/images/textures/planets/StarWars/yavin/iv/yavin4_height.raw
 */

const diffusePath: string | undefined = argument('diffuse')
const heightPath: string | undefined = argument('height')
const levelsArg = argument('levels')

if (!diffusePath || !heightPath) {
  console.error('Нужны --diffuse <файл диффуза> и --height <файл .raw TEHM>')
  process.exit(1)
}

const percentiles: number[] = levelsArg
  ? levelsArg.split(',').map((s) => Number(s.trim()))
  : Array.from({ length: 19 }, (_, i) => (i + 1) * 5) // 5..95 шаг 5

for (const p of percentiles) {
  if (!Number.isFinite(p) || p <= 0 || p >= 100) {
    console.error(`Флаг --levels: перцентили должны быть в (0,100), получено: ${p}`)
    process.exit(1)
  }
}

/** Ближайший сосед src[u,v] в сетке dstWidth×dstHeight — полутекселные центры (та же конвенция, что у карт высот/диффуза). */
function resampleNearest(
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

/**
 * Otsu-порог на гистограмме целых значений [-255, 255] (диапазон blueness):
 * перебор всех порогов, максимизация межклассовой дисперсии
 * w0·w1·(μ0−μ1)². Стандартный метод бимодального разделения — без ручной
 * константы, подстраивается под конкретный диффуз.
 */
function otsuThreshold(values: Int16Array): { threshold: number; fractionAbove: number } {
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

/** k-й наименьший элемент без полной сортировки копии (quickselect, in-place на копии). */
function percentileOf(sortedAscending: Float64Array, p: number): number {
  const idx = Math.min(sortedAscending.length - 1, Math.max(0, Math.floor((p / 100) * (sortedAscending.length - 1))))

  return sortedAscending[idx]
}

async function main(): Promise<void> {
  const { data: diffuseData, info } = await sharp(diffusePath!, { limitInputPixels: false })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const raw = await readFile(heightPath!)
  const map = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)

  const diffuseResampled = resampleNearest(diffuseData, info.width, info.height, info.channels, map.width, map.height)
  const channels = info.channels
  const count = map.width * map.height

  const blueness = new Int16Array(count)
  for (let i = 0; i < count; i++) {
    const r = diffuseResampled[i * channels]
    const g = diffuseResampled[i * channels + 1]
    const b = diffuseResampled[i * channels + 2]
    blueness[i] = b - Math.max(r, g)
  }

  const { threshold: blueThreshold, fractionAbove: waterFractionDiffuse } = otsuThreshold(blueness)
  const waterMask = new Uint8Array(count)
  for (let i = 0; i < count; i++) waterMask[i] = blueness[i] > blueThreshold ? 1 : 0

  console.log(`Диффуз: ${diffusePath} (${info.width}×${info.height}, ресемплен на ${map.width}×${map.height})`)
  console.log(`Height: ${heightPath} (диапазон ${map.minMeters.toFixed(1)}..${map.maxMeters.toFixed(1)} м)`)
  console.log(
    `\nПравило классификации: blueness = B − max(R,G) > ${blueThreshold} (Otsu-порог по гистограмме blueness всей карты)`
  )
  console.log(`Водных текселей диффуза: ${(waterFractionDiffuse * 100).toFixed(2)}% (${count} текселей всего)`)

  const metersPerRaw = (map.maxMeters - map.minMeters) / 65535
  const heightMeters = new Float64Array(count)
  for (let i = 0; i < count; i++) heightMeters[i] = map.minMeters + map.data[i] * metersPerRaw

  const heightSorted = Float64Array.from(heightMeters).sort()

  interface Row {
    percentile: number
    levelMeters: number
    predictedWaterFraction: number
    precision: number
    recall: number
    f1: number
  }

  const rows: Row[] = []

  for (const p of percentiles) {
    const levelMeters = percentileOf(heightSorted, p)

    let tp = 0
    let fp = 0
    let fn = 0
    let predictedWater = 0

    for (let i = 0; i < count; i++) {
      const predicted = heightMeters[i] < levelMeters
      const actual = waterMask[i] === 1
      if (predicted) predictedWater++
      if (predicted && actual) tp++
      else if (predicted && !actual) fp++
      else if (!predicted && actual) fn++
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

    rows.push({
      percentile: p,
      levelMeters,
      predictedWaterFraction: predictedWater / count,
      precision,
      recall,
      f1
    })
  }

  console.log('\nКривая F1 по уровню L:')
  console.table(
    rows.map((row) => ({
      перцентиль: row.percentile,
      'L, м': row.levelMeters.toFixed(1),
      'доля воды при L': `${(row.predictedWaterFraction * 100).toFixed(2)}%`,
      precision: row.precision.toFixed(4),
      recall: row.recall.toFixed(4),
      F1: row.f1.toFixed(4)
    }))
  )

  const best = rows.reduce((a, b) => (b.f1 > a.f1 ? b : a))

  console.log(
    `\nЛучший уровень: L=${best.levelMeters.toFixed(1)} м (перцентиль ${best.percentile}), ` +
      `F1=${best.f1.toFixed(4)}, precision=${best.precision.toFixed(4)}, recall=${best.recall.toFixed(4)}, ` +
      `доля воды на теле при L=${(best.predictedWaterFraction * 100).toFixed(2)}%`
  )

  if (best.f1 < 0.5) {
    console.log(
      '\nF1 < 0.5 на максимуме — корреляция диффуза с height слабая или зеркальная. ' +
        'Кандидат: перегенерировать height с противоположным bump-sign и повторить замер.'
    )
  }
}

await main()
