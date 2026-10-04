import process from 'node:process'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'
import { argument } from './lib/cliArguments'
import { defaultMaxLatDeg, stripeReport, type StripeReport } from './lib/stripeMetrics'

/**
 * Замер широтных швов карты: профиль анизотропии строки и скачок ln A между
 * соседними окнами (`scripts/lib/stripeMetrics.ts`). Для карты высот —
 * поле метров; с `--before` — поле `after − before` (вклад скульпта).
 * С `--slope` печатаются каналы R и G (уклон = (байт−128)/127 × slopeRange);
 * отношение A от масштаба не зависит, `--slope-range` нужен только для единиц.
 *
 * Запуск: npm run measure:stripes -- --height <.raw> [--before <.raw>]
 *   [--slope <.webp> [--slope-range 2]] [--check-lat 27.4,39.2] [--window 6] [--max-lat <град>]
 *
 * Полоса широт по умолчанию — где в строке ≥ 800 текселей (acos(800/ширина));
 * проверяемая широта вне полосы печатается как «вне полосы», не подменяется.
 */

const heightPath = argument('height')
const beforePath = argument('before')
const slopePath = argument('slope')
const checkLat = (argument('check-lat') ?? '').split(',').filter(Boolean).map(Number)
const maxLatArg = argument('max-lat')
const maxLat = (width: number): number => (maxLatArg === undefined ? defaultMaxLatDeg(width) : Number(maxLatArg))
const window = Number(argument('window') ?? 6)
const slopeRange = Number(argument('slope-range') ?? SLOPE_RANGE)

if (!heightPath && !slopePath) {
  console.error('Нужен --height <.raw> и/или --slope <.webp>')
  process.exit(1)
}

if (checkLat.some((v) => !Number.isFinite(v)) || !Number.isInteger(window) || window < 1 || !Number.isFinite(slopeRange) || !Number.isFinite(maxLat(1e9))) {
  console.error('Флаги --check-lat (числа через запятую), --window (целое ≥ 1), --slope-range — числа')
  process.exit(1)
}

async function readHeightMeters(file: string): Promise<{ meters: Float64Array; width: number; height: number }> {
  const raw = await readFile(file)
  const map = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
  const step = (map.maxMeters - map.minMeters) / 65535
  const meters = new Float64Array(map.width * map.height)
  for (let i = 0; i < meters.length; i++) meters[i] = map.minMeters + map.data[i] * step

  return { meters, width: map.width, height: map.height }
}

function print(title: string, r: StripeReport): void {
  console.log(`\n${title}`)
  console.log(`  шов max ${r.maxSeam.toFixed(4)} на ${r.maxSeamLatDeg.toFixed(2)}°, медиана ${r.medianSeam.toFixed(4)}, полоса ±${r.maxLatDeg.toFixed(1)}°`)
  for (const a of r.atLat) {
    if (Number.isNaN(a.seam)) console.log(`  у ${a.latDeg}°: ВНЕ ПОЛОСЫ`)
    else console.log(`  у ${a.latDeg}°: пик шва ${a.seam.toFixed(4)} на ${a.peakLatDeg.toFixed(2)}° (${(a.seam / r.medianSeam).toFixed(1)}× медианы)`)
  }
}

async function main(): Promise<void> {
  console.log(`Окно ${window} строк; пик шва ищется в ±окно от проверяемой широты`)

  if (heightPath) {
    const after = await readHeightMeters(heightPath)
    let field = after.meters
    let title = `Высота, м: ${heightPath}`

    if (beforePath) {
      const before = await readHeightMeters(beforePath)
      if (before.width !== after.width || before.height !== after.height) {
        console.error('Карты --height и --before разного размера')
        process.exit(1)
      }
      field = after.meters.map((v, i) => v - before.meters[i])
      title = `Высота after − before, м: ${heightPath} − ${beforePath}`
    }

    print(title, stripeReport(field, after.width, after.height, checkLat, window, maxLat(after.width)))
  }

  if (slopePath) {
    const { data, info } = await sharp(slopePath, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true })
    const count = info.width * info.height

    for (const [name, channel] of [['R (восток)', 0], ['G (север)', 1]] as const) {
      const field = new Float64Array(count)
      for (let i = 0; i < count; i++) field[i] = ((data[i * info.channels + channel] - 128) / 127) * slopeRange
      print(`Уклон ${name}: ${slopePath}`, stripeReport(field, info.width, info.height, checkLat, window, maxLat(info.width)))
    }
  }
}

await main()
