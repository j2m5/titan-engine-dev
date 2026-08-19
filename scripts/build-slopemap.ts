import process from 'node:process'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { buildSlopeMap } from './lib/slopeMapEncode'
import { argument } from './lib/cliArguments'
import { WATER_SHALLOW_RANGE_METERS } from '@/core/terrain/waterLevel'

/**
 * Slope-карта тела из готовой карты высот: TEHM → изображение с уклонами
 * (R — восток, G — север, знаковая кодировка 128±127, диапазон ±SLOPE_RANGE).
 * Потребитель — slope-путь PlanetMaterial (USE_SLOPE): попиксельный рельеф
 * с мип-фильтрацией поверх геометрии с радиальными нормалями.
 *
 * Формат выхода — по расширению: .webp пишется лоссы без потерь (у карты Луны
 * вдвое меньше PNG при бит-в-бит тех же текселях), остальное — PNG.
 *
 * Запуск: npm run build:slopemap -- --in <файл .raw> --out <файл .webp|.png>
 *   --radius-meters <радиус тела в метрах> [--cavity on|off]
 *   [--water-level-meters <м>] [--shallow-range-meters <м, дефолт 200>]
 *
 * Луна: npm run build:slopemap -- --in moon_height.raw --out moon_slope.webp
 *   --radius-meters 1737400
 * Залить в бакет: s3://textures/planets/moon/moon_slope.webp
 *
 * --cavity: по умолчанию on — канал B несёт signed cavity рельефа (см.
 *   scripts/lib/cavityMap.ts). --cavity off — паритетный режим для
 *   фотомозаичных тел (Меркурий, Венера, Марс, Луна): канал B остаётся
 *   нулевым, выход байт-в-байт как до появления cavity.
 *
 * --water-level-meters: если задан, выход становится 4-канальным RGBA — канал
 *   A несёт запечённую глубину воды (см. scripts/lib/slopeMapEncode.ts). Без
 *   флага выход остаётся 3-канальным RGB байт-в-байт. --shallow-range-meters
 *   задаёт диапазон обмеления (дефолт 200 м), без --water-level-meters
 *   игнорируется.
 */

const input: string | undefined = argument('in')
const output: string | undefined = argument('out')
const radiusArg = argument('radius-meters')
const cavityArg = argument('cavity')
const waterLevelArg = argument('water-level-meters')
const shallowRangeArg = argument('shallow-range-meters')

if (!input || !output || radiusArg === undefined) {
  console.error('Нужны --in <файл .raw>, --out <файл .png> и --radius-meters <метры>')
  process.exit(1)
}

const radiusMeters = Number(radiusArg)

if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
  console.error('Флаг --radius-meters должен быть положительным числом, получено:', radiusArg)
  process.exit(1)
}

if (cavityArg !== undefined && cavityArg !== 'on' && cavityArg !== 'off') {
  console.error('Флаг --cavity принимает только on|off, получено:', cavityArg)
  process.exit(1)
}

const cavity = cavityArg !== 'off'

let waterLevelMeters: number | undefined
if (waterLevelArg !== undefined) {
  waterLevelMeters = Number(waterLevelArg)
  if (!Number.isFinite(waterLevelMeters)) {
    console.error('Флаг --water-level-meters должен быть числом, получено:', waterLevelArg)
    process.exit(1)
  }
}

let shallowRangeMeters: number | undefined
if (shallowRangeArg !== undefined) {
  shallowRangeMeters = Number(shallowRangeArg)
  if (!Number.isFinite(shallowRangeMeters) || shallowRangeMeters <= 0) {
    console.error('Флаг --shallow-range-meters должен быть положительным числом, получено:', shallowRangeArg)
    process.exit(1)
  }
}

// Buffer может быть вью в пуле с ненулевым byteOffset — parseHeightMap ждёт
// ArrayBuffer, начинающийся с заголовка, поэтому режем явно.
const raw = await readFile(input)
const map = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
const encoded = buildSlopeMap(map, radiusMeters, { cavity, waterLevelMeters, shallowRangeMeters })

// Число каналов — по фактическому буферу (3 без воды, 4 с водой), не хардкод:
// sharp пишет lossless webp в обоих случаях.
const channels = (encoded.length / (map.width * map.height)) as 3 | 4
const image = sharp(Buffer.from(encoded.buffer), { raw: { width: map.width, height: map.height, channels } })

await (output.endsWith('.webp') ? image.webp({ lossless: true, effort: 6 }) : image.png({ compressionLevel: 9 }))
  .toFile(output)

console.log(
  `записано ${output}: ${map.width}×${map.height}, радиус ${radiusMeters} м, cavity=${cavity ? 'on' : 'off'}, ` +
    `вода=${waterLevelMeters !== undefined ? `уровень ${waterLevelMeters} м, range ${shallowRangeMeters ?? WATER_SHALLOW_RANGE_METERS} м` : 'off'}`
)
