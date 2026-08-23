import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { encodeHeightMap, normalizeToUint16 } from './lib/heightMapEncode'
import { decodeHeightMeters, enhanceHeightField } from './lib/enhanceHeightMap'
import { boxDownsampleGreyscale } from './lib/batchBodyRules'
import { argument } from './lib/cliArguments'

/**
 * Гибрид карты высот: честный DEM плюс высокочастотная деталь из bump-карты
 * того же тела — `h = dem + band(bump)·A` (математика и мотив — докблок
 * `scripts/lib/enhanceHeightMap.ts`).
 *
 * Запуск: npm run build:enhance-heightmap -- --dem <файл .raw> --bump <изображение>
 *   --radius-meters <метры> --amplitude-meters <метры> --out <файл .raw>
 *   [--band-low-km 40] [--band-high-km 4]
 *
 * `--dem` — существующая карта высот (TEHM), она же задаёт разрешение выхода;
 * bump приводится к нему area-average даунсемплом (`boxDownsampleGreyscale`),
 * апсемпл не делается — вход должен быть не мельче DEM и строго 2:1.
 * `--amplitude-meters` — p99 модуля прибавки, подбирается ЗАМЕРОМ уклона, а не
 * скриптом (калибровки здесь нет намеренно).
 *
 * Меркурий (DEM 8192×4096, тексель ≈ 1.87 км):
 *   npm run build:enhance-heightmap -- --dem mercury_height.prev.raw
 *     --bump mercury_bump.jpg --radius-meters 2439700 --amplitude-meters 1200
 *     --out mercury_height.raw
 * Дальше — slope-карта и компаньон: `build:slopemap` (--cavity off) и
 * `build:terrain-aux` по новому файлу высот.
 */

const demPath: string | undefined = argument('dem')
const bumpPath: string | undefined = argument('bump')
const output: string | undefined = argument('out')

if (!demPath || !bumpPath || !output) {
  console.error('Нужны --dem <файл .raw>, --bump <изображение> и --out <файл .raw>')
  process.exit(1)
}

const radiusArg = argument('radius-meters')
const amplitudeArg = argument('amplitude-meters')
const bandLowArg = argument('band-low-km')
const bandHighArg = argument('band-high-km')

const radiusMeters = Number(radiusArg)
const amplitudeMeters = Number(amplitudeArg)
const bandLowKm = Number(bandLowArg ?? 40)
const bandHighKm = Number(bandHighArg ?? 4)

if (radiusArg === undefined || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
  console.error('Флаг --radius-meters должен быть положительным числом, получено:', radiusArg)
  process.exit(1)
}
// Амплитуда обязательна: молчаливый дефолт «сколько-то метров детали» —
// ровно то решение, которое обязано быть видно в команде прогона.
if (amplitudeArg === undefined || !Number.isFinite(amplitudeMeters) || amplitudeMeters < 0) {
  console.error('Флаг --amplitude-meters должен быть неотрицательным числом, получено:', amplitudeArg)
  process.exit(1)
}
if (!Number.isFinite(bandLowKm) || !Number.isFinite(bandHighKm)) {
  console.error('Флаги --band-low-km/--band-high-km должны быть конечными числами, получено:', bandLowArg, bandHighArg)
  process.exit(1)
}

// Buffer может быть вью в пуле с ненулевым byteOffset — parseHeightMap ждёт
// ArrayBuffer, начинающийся с заголовка (см. build-slopemap.ts).
const raw = await readFile(demPath)
const dem = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)

const metadata = await sharp(bumpPath, { limitInputPixels: false }).metadata()
const sourceWidth = metadata.width
const sourceHeight = metadata.height

if (!sourceWidth || !sourceHeight) {
  console.error('Не удалось прочитать размеры bump-входа:', bumpPath)
  process.exit(1)
}
if (sourceWidth !== 2 * sourceHeight) {
  console.error(`Bump должен быть 2:1 (ширина=2×высота), получено ${sourceWidth}×${sourceHeight}: ${bumpPath}`)
  process.exit(1)
}
if (sourceWidth < dem.width) {
  console.error(`Bump мельче DEM (${sourceWidth}×${sourceHeight} против ${dem.width}×${dem.height}) — апсемпл не делаем`)
  process.exit(1)
}

const { data: bumpBytes } = await sharp(bumpPath, { limitInputPixels: false })
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true })

const bumpLuminance =
  sourceWidth > dem.width
    ? boxDownsampleGreyscale(bumpBytes, sourceWidth, sourceHeight, dem.width, dem.height)
    : Float64Array.from(bumpBytes, (byte) => byte / 255)

const { heights, minMeters, maxMeters } = enhanceHeightField(decodeHeightMeters(dem), bumpLuminance, {
  widthTexels: dem.width,
  heightTexels: dem.height,
  radiusMeters,
  bandLowKm,
  bandHighKm,
  amplitudeMeters
})

const data = normalizeToUint16(Float32Array.from(heights), minMeters, maxMeters)

await writeFile(output, encodeHeightMap({ width: dem.width, height: dem.height, minMeters, maxMeters, data }))

console.log(
  `записано ${output}: ${dem.width}×${dem.height}, полоса ${bandLowKm}..${bandHighKm} км, амплитуда ${amplitudeMeters} м, ` +
    `высоты ${dem.minMeters.toFixed(0)}..${dem.maxMeters.toFixed(0)} → ${minMeters.toFixed(0)}..${maxMeters.toFixed(0)} м`
)
