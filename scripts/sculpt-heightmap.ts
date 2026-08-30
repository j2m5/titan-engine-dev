import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { encodeHeightMap, normalizeToUint16 } from './lib/heightMapEncode'
import { decodeHeightMeters } from './lib/enhanceHeightMap'
import { sculptHeightField } from './lib/sculptHeightMap'
import { slopeStatistics } from './lib/slopeStats'
import { argument } from './lib/cliArguments'

/**
 * Скульптинг карты высот: заострение кромок и гребней усилением полосы
 * самой карты (математика и мотив — докблок `scripts/lib/sculptHeightMap.ts`).
 *
 * Запуск: npm run build:sculpt-heightmap -- --in <файл .raw> --out <файл .raw>
 *   --radius-meters <метры> --gain-convex <k> --gain-concave <k>
 *   [--band-low-km 15] [--band-high-km 2]
 *
 * Усиления обязательны — сколько заострять, решение приёмки, не дефолт скрипта.
 * Печатает перцентили уклона до/после: по p99.9 против `slopeRange` ресурса
 * решается, не пора ли поднять диапазон slope-карты (иначе клип).
 *
 * Луна (8192×4096, тексель ≈ 1.33 км; приёмка 2026-08-30):
 *   npm run build:sculpt-heightmap -- --in moon_height.prev.raw --out moon_height.raw
 *     --radius-meters 1737400 --band-low-km 15 --band-high-km 2
 *     --gain-convex 1.5 --gain-concave 0.5
 * Дальше — `build:slopemap` (--cavity off у фотомозаик) и `build:terrain-aux`
 * по новому файлу высот.
 */

const input: string | undefined = argument('in')
const output: string | undefined = argument('out')

if (!input || !output) {
  console.error('Нужны --in <файл .raw> и --out <файл .raw>')
  process.exit(1)
}

const radiusArg = argument('radius-meters')
const gainConvexArg = argument('gain-convex')
const gainConcaveArg = argument('gain-concave')
const bandLowArg = argument('band-low-km')
const bandHighArg = argument('band-high-km')

const radiusMeters = Number(radiusArg)
const gainConvex = Number(gainConvexArg)
const gainConcave = Number(gainConcaveArg)
const bandLowKm = Number(bandLowArg ?? 15)
const bandHighKm = Number(bandHighArg ?? 2)

if (radiusArg === undefined || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
  console.error('Флаг --radius-meters должен быть положительным числом, получено:', radiusArg)
  process.exit(1)
}
if (gainConvexArg === undefined || !Number.isFinite(gainConvex) || gainConvex < 0) {
  console.error('Флаг --gain-convex должен быть неотрицательным числом, получено:', gainConvexArg)
  process.exit(1)
}
if (gainConcaveArg === undefined || !Number.isFinite(gainConcave) || gainConcave < 0) {
  console.error('Флаг --gain-concave должен быть неотрицательным числом, получено:', gainConcaveArg)
  process.exit(1)
}
if (!Number.isFinite(bandLowKm) || !Number.isFinite(bandHighKm)) {
  console.error('Флаги --band-low-km/--band-high-km должны быть конечными числами, получено:', bandLowArg, bandHighArg)
  process.exit(1)
}

// Buffer может быть вью в пуле с ненулевым byteOffset — parseHeightMap ждёт ArrayBuffer с заголовка.
const raw = await readFile(input)
const source = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)

const { heights, minMeters, maxMeters } = sculptHeightField(decodeHeightMeters(source), {
  widthTexels: source.width,
  heightTexels: source.height,
  radiusMeters,
  bandLowKm,
  bandHighKm,
  gainConvex,
  gainConcave
})

const data = normalizeToUint16(Float32Array.from(heights), minMeters, maxMeters)
const result = { width: source.width, height: source.height, minMeters, maxMeters, data }

await writeFile(output, encodeHeightMap(result))

const fmt = (s: ReturnType<typeof slopeStatistics>): string =>
  `p50 ${s.p50.toFixed(3)} p90 ${s.p90.toFixed(3)} p99 ${s.p99.toFixed(3)} p99.9 ${s.p999.toFixed(3)} max ${s.max.toFixed(2)}`

console.log(
  `записано ${output}: ${source.width}×${source.height}, полоса ${bandLowKm}..${bandHighKm} км, ` +
    `усиление выпуклое ${gainConvex} / вогнутое ${gainConcave}, ` +
    `высоты ${source.minMeters.toFixed(0)}..${source.maxMeters.toFixed(0)} → ${minMeters.toFixed(0)}..${maxMeters.toFixed(0)} м`
)
console.log(`уклоны до:    ${fmt(slopeStatistics(source, radiusMeters))}`)
console.log(`уклоны после: ${fmt(slopeStatistics(result, radiusMeters))}`)
