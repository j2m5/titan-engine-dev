import process from 'node:process'
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { encodeHeightMap, normalizeToUint16 } from './lib/heightMapEncode'
import { buildSynthHeightField, type SynthHeightParams } from './lib/synthHeightMap'
import { argument } from './lib/cliArguments'

/**
 * Оффлайн-генератор карты высот тела БЕЗ DEM: спектральная сборка
 * `h = подложка(dir̂) + band(bump)·амплитуда` из существующей bump-карты
 * (средние частоты рельефа — производная от bump ПО ПОСТРОЕНИЮ совпадает
 * с фичами диффуза) + процедурная НЧ-подложка (глобальная асимметрия тела,
 * НЕ шумовая рябь — см. `scripts/lib/synthNoise.ts`). Выход — TEHM тем же
 * писателем, что и лунный конвейер (`build-heightmap.ts`): тело идёт по
 * готовому рантайм-пути (квадродерево, slope-шейдинг, детальные текстуры).
 *
 * Полосовой фильтр (`bandPassSpherical`) вырезает диапазон `--band-low-km`..
 * `--band-high-km` (км волны на теле, переводятся в тексели экватора формулой
 * `σ_текселей = км·1000 / (2π·radiusMeters/width)`), нормируется по 99-му
 * процентилю МОДУЛЯ (единичный выброс яркости bump не сжимает типичный
 * рельеф), домножается на `--bump-amplitude-meters` и знак `--bump-sign`.
 *
 * Методика калибровки `--bump-amplitude-meters`: после band-фильтра и
 * p99-нормировки типичный крупный элемент рельефа (яркость на уровне p99)
 * получает высоту РОВНО `--bump-amplitude-meters` (знак — `--bump-sign`).
 * Чтобы подобрать значение, нужна независимая физическая привязка —
 * известная глубина крупных элементов рельефа тела из литературы. Для
 * Каллисто это глубина крупных ударных кратеров, ~2–4 км (диапазон значений
 * по разным источникам и морфологиям кратеров) — значение по умолчанию
 * пресета `cratered-icy` (3000 м) взято серединой диапазона. Итоговая точная
 * подгонка — визуальная A/B-приёмка владельца (силуэт кратеров на просвет,
 * терминатор), не формула: bump-яркость — не прямая геометрия, а прокси.
 *
 * `--raw` — отладочный обход band-фильтра и подложки: высоты = яркость ×
 * `--bump-amplitude-meters` × `--bump-sign`, напрямую из исходного bump.
 *
 * Разрешение выхода = разрешению входного bump, обязательно 2:1 (ширина к
 * высоте) — как у любой эквиректангулярной карты высот движка.
 *
 * Запуск (пресет cratered-icy — единственный в v1, дефолты можно
 * переопределить любым флагом):
 *   npm run build:synth-heightmap -- --in <bump.jpg> --out <тело_height.raw>
 *     --radius-meters <радиус тела в метрах> --preset cratered-icy --seed <N>
 *
 * Каллисто (пилот арки):
 *   npm run build:synth-heightmap -- --in storage/images/textures/planets/callisto/callisto_bump.jpg
 *     --out storage/images/textures/planets/callisto/callisto_height.raw
 *     --radius-meters 2410300 --preset cratered-icy --seed 23
 *
 * Slope-карта — существующим `npm run build:slopemap` над результатом, без изменений.
 */

/** Дефолты единственного пресета v1 — «кратерное ледяное тело» (Каллисто-подобная морфология). */
const CRATERED_ICY_PRESET = {
  baseAmplitudeMeters: 800,
  bumpAmplitudeMeters: 3000,
  bandLowKm: 1500,
  bandHighKm: 30,
  bumpSign: 1 as const
}

const input: string | undefined = argument('in')
const output: string | undefined = argument('out')
const radiusArg = argument('radius-meters')
const presetArg = argument('preset')

if (!input || !output || radiusArg === undefined) {
  console.error('Нужны --in <файл bump>, --out <файл .raw> и --radius-meters <метры>')
  process.exit(1)
}

const radiusMeters = Number(radiusArg)
if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
  console.error('Флаг --radius-meters должен быть положительным числом, получено:', radiusArg)
  process.exit(1)
}

if (presetArg !== undefined && presetArg !== 'cratered-icy') {
  console.error('Неизвестный --preset (в v1 доступен только cratered-icy), получено:', presetArg)
  process.exit(1)
}

const seed = Number(argument('seed') ?? 0)
if (!Number.isFinite(seed)) {
  console.error('Флаг --seed должен быть конечным числом, получено:', argument('seed'))
  process.exit(1)
}

// Дефолты пресета, ручки перекрывают явно заданные значения по одной.
function numericFlag(name: string, presetValue: number): number {
  const raw = argument(name)
  if (raw === undefined) return presetValue

  const value = Number(raw)
  if (!Number.isFinite(value)) {
    console.error(`Флаг --${name} должен быть конечным числом, получено:`, raw)
    process.exit(1)
  }
  return value
}

const baseAmplitudeMeters = numericFlag('base-amplitude-meters', CRATERED_ICY_PRESET.baseAmplitudeMeters)
const bumpAmplitudeMeters = numericFlag('bump-amplitude-meters', CRATERED_ICY_PRESET.bumpAmplitudeMeters)
const bandLowKm = numericFlag('band-low-km', CRATERED_ICY_PRESET.bandLowKm)
const bandHighKm = numericFlag('band-high-km', CRATERED_ICY_PRESET.bandHighKm)

const bumpSignArg = argument('bump-sign')
const bumpSignValue = bumpSignArg === undefined ? CRATERED_ICY_PRESET.bumpSign : Number(bumpSignArg)
if (bumpSignValue !== 1 && bumpSignValue !== -1) {
  console.error('Флаг --bump-sign должен быть 1 или -1, получено:', bumpSignArg)
  process.exit(1)
}
const bumpSign: 1 | -1 = bumpSignValue

const raw = process.argv.includes('--raw')

// Bump → серая яркость [0..1]: sharp читает и приводит к одному каналу,
// raw-буфер даёт байты 0..255 без промежуточного файла.
const { data: greyData, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true })

if (info.width !== 2 * info.height) {
  console.error(`Bump-карта должна быть 2:1 (ширина=2×высота), получено ${info.width}×${info.height}`)
  process.exit(1)
}

const bumpLuminance = new Float64Array(info.width * info.height)
for (let i = 0; i < bumpLuminance.length; i++) bumpLuminance[i] = greyData[i] / 255

const params: SynthHeightParams = {
  widthTexels: info.width,
  heightTexels: info.height,
  radiusMeters,
  seed,
  baseAmplitudeMeters,
  bumpAmplitudeMeters,
  bandLowKm,
  bandHighKm,
  bumpSign,
  raw
}

const { heights, minMeters, maxMeters } = buildSynthHeightField(bumpLuminance, params)
const data = normalizeToUint16(Float32Array.from(heights), minMeters, maxMeters)

await writeFile(output, encodeHeightMap({ width: info.width, height: info.height, minMeters, maxMeters, data }))

console.log(
  `записано ${output}: ${info.width}×${info.height}, высоты ${minMeters.toFixed(0)}..${maxMeters.toFixed(0)} м` +
    (raw ? ' (--raw)' : ` (band ${bandLowKm}..${bandHighKm} км, подложка ${baseAmplitudeMeters} м)`)
)
