import process from 'node:process'
import { writeFile } from 'node:fs/promises'
import { resampleDem } from './lib/resampleDem'
import { encodeHeightMap, normalizeToUint16 } from './lib/heightMapEncode'

/**
 * Подготовка карты высот тела: DEM (GeoTIFF/PNG) → raw Uint16 + заголовок TEHM.
 *
 * Запуск: npm run build:heightmap -- --in <файл> --out <файл> [--width 8192]
 *   [--height 4096] [--min-meters N --max-meters N]
 *
 * Без --min/--max диапазон берётся из данных после ресемпла. Для тел с
 * известной привязкой (LOLA: высоты от радиуса 1737.4 км) значения лучше
 * задавать явно — тогда нормировка не зависит от артефактов ресемпла.
 *
 * Луна (пример):
 *   1. Скачать LDEM GeoTIFF: https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m
 *      (public domain, NASA/LRO LOLA; хватит даунсемпленной версии)
 *   2. npm run build:heightmap -- --in LDEM.tif --out moon_height.raw
 *   3. Залить в бакет: s3://textures/planets/moon/moon_height.raw
 */
function argument(name: string): string | undefined {
  const index: number = process.argv.indexOf(`--${name}`)

  return index === -1 ? undefined : process.argv[index + 1]
}

const input: string | undefined = argument('in')
const output: string | undefined = argument('out')
const width: number = Number(argument('width') ?? 8192)
const height: number = Number(argument('height') ?? 4096)

if (!input || !output) {
  console.error('Нужны --in <файл DEM> и --out <файл .raw>')
  process.exit(1)
}

const dem = await resampleDem(input, width, height)

let minMeters: number = argument('min-meters') !== undefined ? Number(argument('min-meters')) : Infinity
let maxMeters: number = argument('max-meters') !== undefined ? Number(argument('max-meters')) : -Infinity

if (!Number.isFinite(minMeters) || !Number.isFinite(maxMeters)) {
  for (const value of dem.data) {
    if (value < minMeters) minMeters = value
    if (value > maxMeters) maxMeters = value
  }
}

const data = normalizeToUint16(dem.data, minMeters, maxMeters)

await writeFile(output, encodeHeightMap({ width: dem.width, height: dem.height, minMeters, maxMeters, data }))

console.log(`записано ${output}: ${dem.width}×${dem.height}, высоты ${minMeters.toFixed(0)}..${maxMeters.toFixed(0)} м`)
