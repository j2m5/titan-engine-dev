import process from 'node:process'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { buildSlopeMap } from './lib/slopeMapEncode'
import { argument } from './lib/cliArguments'

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
 *   --radius-meters <радиус тела в метрах>
 *
 * Луна: npm run build:slopemap -- --in moon_height.raw --out moon_slope.webp
 *   --radius-meters 1737400
 * Залить в бакет: s3://textures/planets/moon/moon_slope.webp
 */

const input: string | undefined = argument('in')
const output: string | undefined = argument('out')
const radiusArg = argument('radius-meters')

if (!input || !output || radiusArg === undefined) {
  console.error('Нужны --in <файл .raw>, --out <файл .png> и --radius-meters <метры>')
  process.exit(1)
}

const radiusMeters = Number(radiusArg)

if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
  console.error('Флаг --radius-meters должен быть положительным числом, получено:', radiusArg)
  process.exit(1)
}

// Buffer может быть вью в пуле с ненулевым byteOffset — parseHeightMap ждёт
// ArrayBuffer, начинающийся с заголовка, поэтому режем явно.
const raw = await readFile(input)
const map = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
const rgb = buildSlopeMap(map, radiusMeters)

const image = sharp(Buffer.from(rgb.buffer), { raw: { width: map.width, height: map.height, channels: 3 } })

await (output.endsWith('.webp') ? image.webp({ lossless: true, effort: 6 }) : image.png({ compressionLevel: 9 }))
  .toFile(output)

console.log(`записано ${output}: ${map.width}×${map.height}, радиус ${radiusMeters} м`)
