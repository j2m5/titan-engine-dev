import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { resampleDem } from './lib/resampleDem'
import { readRawInt16Dem, resampleDemGrid } from './lib/rawDem'
import { encodeHeightMap, normalizeToUint16, resolveHeightRange } from './lib/heightMapEncode'

/**
 * Подготовка карты высот тела: DEM (GeoTIFF/PNG или сырой PDS IMG) →
 * raw Uint16 + заголовок TEHM.
 *
 * Запуск: npm run build:heightmap -- --in <файл> --out <файл> [--width 8192]
 *   [--height 4096] [--min-meters N --max-meters N]
 *   [--in-width N --in-height N [--scale-meters K]]
 *
 * Два режима входа:
 *   - GeoTIFF/PNG — читается sharp'ом, размеры из файла;
 *   - сырой int16 LE (PDS IMG: так LOLA/MOLA раздают даунсемплы) — включается
 *     парой --in-width/--in-height (размеры из .LBL-лейбла рядом с файлом),
 *     --scale-meters переводит значение в метры (по умолчанию 1).
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
for (const [name, value] of [
  ['in-width', inWidthArg],
  ['in-height', inHeightArg],
  ['scale-meters', scaleArg]
] as const) {
  if (value !== undefined && !Number.isFinite(Number(value))) {
    console.error(`Флаг --${name} должен быть конечным числом, получено:`, value)
    process.exit(1)
  }
}

const dem =
  inWidthArg !== undefined && inHeightArg !== undefined
    ? await (async () => {
        const source = readRawInt16Dem(
          await readFile(input),
          Number(inWidthArg),
          Number(inHeightArg),
          Number(scaleArg ?? 1)
        )

        return { width, height, data: resampleDemGrid(source, Number(inWidthArg), Number(inHeightArg), width, height) }
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
