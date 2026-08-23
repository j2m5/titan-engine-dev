import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { resampleDem } from './lib/resampleDem'
import { readRawInt16Dem, resampleDemGrid } from './lib/rawDem'
import { readGeoTiffInt16 } from './lib/geoTiffInt16'
import { readGeoTiffFloat32 } from './lib/geoTiffFloat32'
import { readGeoTiffHeader } from './lib/geoTiffIfd'
import { encodeHeightMap, normalizeToUint16, resolveHeightRange } from './lib/heightMapEncode'
import { argument } from './lib/cliArguments'

/**
 * Подготовка карты высот тела: DEM (GeoTIFF int16/PNG или сырой PDS IMG) →
 * raw Uint16 + заголовок TEHM.
 *
 * Запуск: npm run build:heightmap -- --in <файл> --out <файл> [--width 8192]
 *   [--height 4096] [--min-meters N --max-meters N]
 *   [--in-width N --in-height N [--scale-meters K] [--big-endian]]
 *   [--scale-meters K] [--offset-meters K] [--nodata-fill N]
 *
 * Три режима входа:
 *   - **.tif/.tiff** (strip-based, без сжатия) — читается собственными
 *     ридерами по тегу SampleFormat: 2 → `lib/geoTiffInt16.ts` (signed int16,
 *     так USGS Astrogeology раздаёт DEM планет), 3 → `lib/geoTiffFloat32.ts`
 *     (float32, так раздают DEM внешних спутников — Энцелад Schenk 2024).
 *     Не sharp: на int16-файлах sharp путает буфер пикселей (см. докблок
 *     модуля), а его путь ресемплит ДО подмены NODATA. Scale/offset
 *     авто-детектятся из встроенных GDAL-тегов файла (`GDAL_METADATA`
 *     SCALE/OFFSET), `--scale-meters`/`--offset-meters` их переопределяют;
 *     итоговая высота = `DN×scale + offset`. NODATA-текселы (тег
 *     `GDAL_NODATA`, если есть) заменяются на `--nodata-fill <метры>`
 *     (по умолчанию 0 — опорная сфера); доля замены печатается в консоль —
 *     если она заметная (проценты, не доли процента), решение по значению
 *     заполнения проверить на приёмке.
 *   - GeoTIFF (float)/PNG прочих форматов — читается sharp'ом, размеры из файла;
 *   - сырой int16 (PDS IMG: так LOLA/MOLA раздают даунсемплы) — включается
 *     парой --in-width/--in-height (размеры из .LBL-лейбла рядом с файлом),
 *     --scale-meters переводит значение в метры (по умолчанию 1). Порядок
 *     байт — по умолчанию little-endian (LOLA, DATA_TYPE=LSB_INTEGER);
 *     --big-endian переключает на MSB_INTEGER (MOLA/PDS MEGDR — сверить
 *     DATA_TYPE в .LBL; спутанный порядок даёт min/max у границ int16
 *     ±32767/±32768 вместо физического диапазона — верный сигнал перепроверить
 *     флаг санити-проверкой перед принятием карты).
 *
 * Без --min/--max диапазон берётся из данных после ресемпла. Для тел с
 * известной привязкой (LOLA: высоты от радиуса 1737.4 км) значения лучше
 * задавать явно — тогда нормировка не зависит от артефактов ресемпла.
 *
 * Луна (рекомендуемый путь, 530 МБ вместо 8 ГБ GeoTIFF):
 *   1. Скачать LDEM_64.IMG (public domain, NASA/LRO LOLA, 23040×11520,
 *      единицы 0.5 м): https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_64.IMG
 *   2. npm run build:heightmap -- --in LDEM_64.IMG --out moon_height.raw
 *        --in-width 23040 --in-height 11520 --scale-meters 0.5
 *   3. Залить в бакет: s3://textures/planets/moon/moon_height.raw
 */
const input: string | undefined = argument('in')
const output: string | undefined = argument('out')
const width: number = Number(argument('width') ?? 8192)
const height: number = Number(argument('height') ?? 4096)

if (!input || !output) {
  console.error('Нужны --in <файл DEM> и --out <файл .raw>')
  process.exit(1)
}

// Валидация числовых флагов: если флаг задан, Number(...) должен быть конечным числом.
// Это ловит случай «флаг без значения» (argument() возвращает следующий флаг → NaN).
if (!Number.isFinite(width)) {
  console.error('Флаг --width должен быть конечным числом, получено:', argument('width'))
  process.exit(1)
}
if (!Number.isFinite(height)) {
  console.error('Флаг --height должен быть конечным числом, получено:', argument('height'))
  process.exit(1)
}

const minArg = argument('min-meters')
const maxArg = argument('max-meters')

// Валидация флагов диапазона до загрузки файла — экономит время на битых аргументах.
if (minArg !== undefined && !Number.isFinite(Number(minArg))) {
  console.error('Флаг --min-meters должен быть конечным числом, получено:', minArg)
  process.exit(1)
}
if (maxArg !== undefined && !Number.isFinite(Number(maxArg))) {
  console.error('Флаг --max-meters должен быть конечным числом, получено:', maxArg)
  process.exit(1)
}

const inWidthArg = argument('in-width')
const inHeightArg = argument('in-height')
const scaleArg = argument('scale-meters')

// Сырой режим требует обеих размерностей: одна без другой — почти наверняка опечатка
if ((inWidthArg !== undefined) !== (inHeightArg !== undefined)) {
  console.error('Флаги --in-width и --in-height задаются только парой')
  process.exit(1)
}
const offsetArg = argument('offset-meters')
const nodataFillArg = argument('nodata-fill')

for (const [name, value] of [
  ['in-width', inWidthArg],
  ['in-height', inHeightArg],
  ['scale-meters', scaleArg],
  ['offset-meters', offsetArg],
  ['nodata-fill', nodataFillArg]
] as const) {
  if (value !== undefined && !Number.isFinite(Number(value))) {
    console.error(`Флаг --${name} должен быть конечным числом, получено:`, value)
    process.exit(1)
  }
}

const bigEndian = process.argv.includes('--big-endian')
const isTiff = /\.tiff?$/i.test(input)

const dem =
  inWidthArg !== undefined && inHeightArg !== undefined
    ? await (async () => {
        const source = readRawInt16Dem(
          await readFile(input),
          Number(inWidthArg),
          Number(inHeightArg),
          Number(scaleArg ?? 1),
          bigEndian
        )

        return { width, height, data: resampleDemGrid(source, Number(inWidthArg), Number(inHeightArg), width, height) }
      })()
    : isTiff
      ? await (async () => {
          const buffer = await readFile(input)
          // Формат сэмплов решает ридер: 3 — IEEE float32, иначе signed int16 (ридер сам отвергнет чужой тег).
          const parsed = readGeoTiffHeader(buffer).sampleFormat === 3 ? readGeoTiffFloat32(buffer) : readGeoTiffInt16(buffer)
          const scale = scaleArg !== undefined ? Number(scaleArg) : parsed.scale
          const offset = offsetArg !== undefined ? Number(offsetArg) : parsed.offset
          const nodataFillMeters = nodataFillArg !== undefined ? Number(nodataFillArg) : 0

          const meters = new Float32Array(parsed.data.length)
          let nodataCount = 0

          for (let i = 0; i < parsed.data.length; i++) {
            const dn = parsed.data[i]

            if (parsed.nodata !== undefined && dn === parsed.nodata) {
              meters[i] = nodataFillMeters
              nodataCount++
            } else {
              meters[i] = dn * scale + offset
            }
          }

          if (nodataCount > 0) {
            console.log(
              `GeoTIFF: NODATA-текселей ${nodataCount} из ${parsed.data.length} ` +
                `(${((100 * nodataCount) / parsed.data.length).toFixed(2)}%), заменены на ${nodataFillMeters} м`
            )
          }

          return { width, height, data: resampleDemGrid(meters, parsed.width, parsed.height, width, height) }
        })()
      : await resampleDem(input, width, height)

// Разрешение диапазона высот: явные аргументы приоритизируются, отсутствующие берутся из данных.
// Отслеживаем явность каждой границы отдельно — скан не трогает явно заданные значения.
const { minMeters, maxMeters } = resolveHeightRange(
  dem.data,
  minArg !== undefined ? Number(minArg) : undefined,
  maxArg !== undefined ? Number(maxArg) : undefined
)

const data = normalizeToUint16(dem.data, minMeters, maxMeters)

await writeFile(output, encodeHeightMap({ width: dem.width, height: dem.height, minMeters, maxMeters, data }))

console.log(`записано ${output}: ${dem.width}×${dem.height}, высоты ${minMeters.toFixed(0)}..${maxMeters.toFixed(0)} м`)
