import process from 'node:process'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { buildSynthHeightField, type SynthHeightParams } from './lib/synthHeightMap'
import { encodeHeightMap, normalizeToUint16 } from './lib/heightMapEncode'
import { buildSlopeMap, SLOPE_RANGE } from './lib/slopeMapEncode'
import { autoCalibrateAmplitude, type CalibrationSample } from './lib/autoCalibrate'
import { argument } from './lib/cliArguments'

/**
 * Батч-оркестратор перевода спутников на конвейер «тел без DEM» (арка
 * synth-heightmap): один прогон генерит height+slope для всех записей
 * `BODIES` (декларативный список — 18 генераций на 18 тел; фикс-раунд 1
 * реального прогона развёл Корribан I-VII на семь ПЕР-ТЕЛО генераций, общий
 * только вход-текстура, см. ниже). Математика синтеза НЕ дублируется:
 * вызывает тот же библиотечный конвейер, что и одиночный
 * `build:synth-heightmap` (`buildSynthHeightField`, `buildSlopeMap`,
 * писатель TEHM `encodeHeightMap`).
 *
 * Автокалибровка амплитуды (`autoCalibrateAmplitude`) подгоняет
 * `bumpAmplitudeMeters` под целевой RMS(tan) итоговой slope-карты вместо
 * фиксированного значения на тело — референс 3000 м, цель 0.07 (см. докблок
 * `autoCalibrate.ts`). Кламп 0.7% радиуса — ДВУХэтапный (фикс-раунд 1,
 * находка 1): `autoCalibrateAmplitude` сама клампит только ПАРАМЕТР
 * bump-амплитуды, а не итоговый пик поля (подложка ей не подконтрольна);
 * после калибровки `generateBody` меряет фактический max(|min|,|max|)
 * последнего прогона и, если он всё же над бюджетом, делает ОДНУ
 * повторную генерацию с пропорционально рескейленными bump- И base-
 * амплитудами (see `generateBody`).
 *
 * Даунсемпл входа — до потолка по радиусу тела, area-average (box) для
 * 8-бит растра (`boxDownsampleGreyscale`, тонкая самостоятельная реализация:
 * установленный sharp box-кернел не экспонирует, а `resampleDem.ts` заточен
 * под float DEM-числа другого конвейера — переиспользовать нечего).
 *
 * Пути вывода — `<каталог входного файла>/<имя>_height.raw` и `<имя>_slope.webp`
 * (имя — колонка «Генерация» списка ниже); у Корribана каталог входного
 * файла общий на семь генераций (входная текстура одна), но КАЖДАЯ из
 * korriban1..korriban7 пишет СВОИ height/slope — общий физический ресурс
 * Корribана в БД был ошибкой (радиус I откалиброван на VII дал 577% его
 * бюджета высоты), поэтому этот батч больше не производит общую карту.
 *
 * Запуск (все 18 генераций):
 *   npm run build:moon-heightmaps
 * Перегенерировать одно тело:
 *   npm run build:moon-heightmaps -- --only rhea
 */

/** Дефолт подложки — тот же пресет cratered-icy, что и у одиночного build:synth-heightmap (докблок там же). */
const BASE_AMPLITUDE_METERS = 800
const REF_AMPLITUDE_METERS = 3000
const TARGET_RMS_TAN = 0.07
/** Кламп амплитуды — доля радиуса тела (0.7%). */
const HEIGHT_BUDGET_FRACTION = 0.007
/** band-low по умолчанию, км — переопределяется половиной окружности у малых тел (см. `bandLowKmFor`). */
const BAND_LOW_KM_DEFAULT = 1500
/** band-high = N текселей экватора карты ВЫХОДНОГО разрешения тела. */
const BAND_HIGH_TEXELS = 2

interface BodyGeneration {
  /** Колонка «Генерация» — имя выходных файлов и ключ `--only`. */
  name: string
  inputPath: string
  inputKind: 'bump' | 'diffuse'
  radiusMeters: number
  /** seed синтеза — actorId тела. */
  seedActorId: number
  /** actorId, ссылающийся на эту генерацию (по одному на генерацию — см. фикс-раунд 1, находка 2). */
  actorIds: readonly number[]
}

const TEXTURES_ROOT = 'storage/images/textures/planets'

/**
 * Список генераций — изначально см. «Список генераций (12 уникальных карт →
 * 18 тел)» в плане арки (`docs/superpowers/plans/2026-08-16-terrain-moons-batch.md`);
 * фикс-раунд 1 (находка 2, рулинг контроллера) развёл общую карту Корribана
 * на семь ПЕР-ТЕЛО генераций — общий бюджет 0.7% радиуса I (1740 км),
 * откалиброванный под неё height/slope, давал VII (175 км) 577% ЕЁ бюджета.
 * Пути и радиусы — константы из инвентаризации/resources.ts, БД не читается.
 */
const BODIES: readonly BodyGeneration[] = [
  {
    name: 'io',
    inputPath: `${TEXTURES_ROOT}/io/io.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 1_821_500,
    seedActorId: 20,
    actorIds: [20]
  },
  {
    name: 'ganymede',
    inputPath: `${TEXTURES_ROOT}/ganymede/ganymede.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 2_631_200,
    seedActorId: 22,
    actorIds: [22]
  },
  {
    name: 'rhea',
    inputPath: `${TEXTURES_ROOT}/rhea/rhea_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 764_500,
    seedActorId: 28,
    actorIds: [28]
  },
  {
    name: 'titan',
    inputPath: `${TEXTURES_ROOT}/titan/titan_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 2_575_000,
    seedActorId: 29,
    actorIds: [29]
  },
  {
    name: 'iapetus',
    inputPath: `${TEXTURES_ROOT}/iapetus/iapetus.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 734_500,
    seedActorId: 30,
    actorIds: [30]
  },
  {
    name: 'triton',
    inputPath: `${TEXTURES_ROOT}/triton/triton_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 1_352_600,
    seedActorId: 36,
    actorIds: [36]
  },
  {
    // 16k-вариант с диска (не тот, что в resources.ts) — больше сигнала до даунсемпла
    name: 'charon',
    inputPath: `${TEXTURES_ROOT}/charon/charon_16k.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 606_000,
    seedActorId: 37,
    actorIds: [37]
  },
  {
    // 16k-вариант с диска — та же причина, что у Харона
    name: 'dysnomia',
    inputPath: `${TEXTURES_ROOT}/dysnomia/dysnomia_bump_16k.jpg`,
    inputKind: 'bump',
    radiusMeters: 320_000,
    seedActorId: 38,
    actorIds: [38]
  },
  {
    name: 'adriana3',
    inputPath: `${TEXTURES_ROOT}/StarWars/adriana3/adriana3_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 2_256_760,
    seedActorId: 73,
    actorIds: [73]
  },
  {
    name: 'yavin4',
    inputPath: `${TEXTURES_ROOT}/StarWars/yavin/iv/iv.png`,
    inputKind: 'diffuse',
    radiusMeters: 6_100_000,
    seedActorId: 83,
    actorIds: [83]
  },
  {
    name: 'ohann3',
    inputPath: `${TEXTURES_ROOT}/unnamed/unnamed_planet_7.png`,
    inputKind: 'diffuse',
    radiusMeters: 347_190,
    seedActorId: 70,
    actorIds: [70]
  },
  // Korriban I-VII делят один физический вход (actorResource.ts переиспользует
  // resourceId 117/118 для actorId 93-99), но КАЖДОЕ тело — своя генерация:
  // общий выход, откалиброванный под радиус I, перегружал бюджет высоты
  // мелких тел семьи (см. докблок модуля, находка 2). Радиусы — инвентаризация.
  {
    name: 'korriban1',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 1_740_000,
    seedActorId: 93,
    actorIds: [93]
  },
  {
    name: 'korriban2',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 980_000,
    seedActorId: 94,
    actorIds: [94]
  },
  {
    name: 'korriban3',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 1_290_000,
    seedActorId: 95,
    actorIds: [95]
  },
  {
    name: 'korriban4',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 640_000,
    seedActorId: 96,
    actorIds: [96]
  },
  {
    name: 'korriban5',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 410_000,
    seedActorId: 97,
    actorIds: [97]
  },
  {
    name: 'korriban6',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 240_000,
    seedActorId: 98,
    actorIds: [98]
  },
  {
    name: 'korriban7',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 175_000,
    seedActorId: 99,
    actorIds: [99]
  }
]

interface ReportRow {
  name: string
  actorIds: readonly number[]
  inputPath: string
  inputKind: 'bump' | 'diffuse'
  width: number
  height: number
  amplitudeMeters: number
  rmsTan: number
  peakMeters: number
  budgetMeters: number
  minMeters: number
  maxMeters: number
  clamped: boolean
  iterations: number
  heightPath: string
  slopePath: string
  heightBytes: number
  slopeVramMiB: number
}

/** Фактический пик поля высот — max(|min|,|max|), честная величина для сверки с бюджетом (не амплитуда-параметр). */
function peakMetersOf(map: HeightMapData): number {
  return Math.max(Math.abs(map.minMeters), Math.abs(map.maxMeters))
}

/** Потолок разрешения по радиусу тела — Global Constraints плана арки; выход = min(источник, потолок). */
function resolutionCeiling(radiusMeters: number): number {
  const radiusKm = radiusMeters / 1000

  if (radiusKm >= 1500) return 8192
  if (radiusKm >= 500) return 4096

  return 2048
}

/** band-low: 1500 км по умолчанию, либо половина окружности тела, если тело мельче. */
function bandLowKmFor(radiusMeters: number): number {
  const halfCircumferenceKm = (Math.PI * radiusMeters) / 1000

  return Math.min(BAND_LOW_KM_DEFAULT, halfCircumferenceKm)
}

/**
 * Area-average (box) даунсемпл яркости [0..1] до кратного целого коэффициента
 * уменьшения. НЕ через sharp `.resize` — установленная версия sharp не
 * экспонирует box-кернел (`sharp.kernel` даёт только nearest/linear/cubic/
 * mitchell/lanczos2/lanczos3/mks2013/mks2021, без box); `resampleDem.ts`
 * заточен под float DEM другого конвейера (lanczos3, `.raw({depth:'float'})`)
 * — копировать нечего, кернел там для другой задачи. Коэффициент должен
 * делить оба измерения нацело — потолки разрешения батча (`resolutionCeiling`)
 * и реальные размеры входов это гарантируют для всех 12 генераций.
 */
function boxDownsampleGreyscale(
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Float64Array {
  if (sourceWidth % targetWidth !== 0 || sourceHeight % targetHeight !== 0) {
    throw new Error(
      `Даунсемпл: источник ${sourceWidth}×${sourceHeight} не делится нацело на выход ${targetWidth}×${targetHeight}`
    )
  }

  const blockW = sourceWidth / targetWidth
  const blockH = sourceHeight / targetHeight
  const out = new Float64Array(targetWidth * targetHeight)

  for (let ty = 0; ty < targetHeight; ty++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      let sum = 0
      for (let by = 0; by < blockH; by++) {
        const rowOffset = (ty * blockH + by) * sourceWidth
        for (let bx = 0; bx < blockW; bx++) sum += source[rowOffset + tx * blockW + bx]
      }
      out[ty * targetWidth + tx] = sum / (blockW * blockH * 255)
    }
  }

  return out
}

/**
 * Вход → яркость [0..1] в целевом (даунсемпленном) разрешении. 2:1 проверяется
 * до ресемпла — источник должен быть честной эквиректангулярной картой.
 * Ресемпл (`boxDownsampleGreyscale`) — только если целевая ширина меньше
 * исходной (без апсемпла).
 */
async function loadDownsampledGreyscale(
  inputPath: string,
  ceilingWidth: number
): Promise<{ width: number; height: number; luminance: Float64Array }> {
  const metadata = await sharp(inputPath, { limitInputPixels: false }).metadata()
  const sourceWidth = metadata.width
  const sourceHeight = metadata.height

  if (!sourceWidth || !sourceHeight) {
    throw new Error(`Не удалось прочитать размеры входа: ${inputPath}`)
  }
  if (sourceWidth !== 2 * sourceHeight) {
    throw new Error(`Вход должен быть 2:1 (ширина=2×высота), получено ${sourceWidth}×${sourceHeight}: ${inputPath}`)
  }

  const width = Math.min(sourceWidth, ceilingWidth)
  const height = width / 2

  const { data } = await sharp(inputPath, { limitInputPixels: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const luminance =
    width < sourceWidth ? boxDownsampleGreyscale(data, sourceWidth, sourceHeight, width, height) : normalizeBytes(data)

  return { width, height, luminance }
}

/** Байты [0..255] → яркость [0..1], без ресемпла. */
function normalizeBytes(data: Buffer): Float64Array {
  const out = new Float64Array(data.length)
  for (let i = 0; i < out.length; i++) out[i] = data[i] / 255

  return out
}

/**
 * RMS(tan) slope-карты — векторная величина по R(восток)/G(север) (B всегда
 * ноль). Считаем прямо на буфере `buildSlopeMap` — это байт-в-байт то, что
 * дальше пишется в lossless webp, раскодировка готового файла sharp'ом дала
 * бы те же числа; лишний файловый круг во время калибровки не нужен.
 */
function measureRmsTan(rgb: Uint8Array, width: number, height: number): number {
  const decode = (byte: number): number => ((byte - 128) / 127) * SLOPE_RANGE
  const count = width * height
  let sumSquares = 0

  for (let i = 0; i < count; i++) {
    const east = decode(rgb[i * 3])
    const north = decode(rgb[i * 3 + 1])
    sumSquares += east * east + north * north
  }

  return Math.sqrt(sumSquares / count)
}

/**
 * Один прогон конвейера: синтез поля высот → нормировка → slope-карта →
 * замер RMS(tan). `baseAmplitudeMeters` — параметр, а не константа модуля:
 * пост-коррекция по фактическому пику (см. `generateBody`) рескейлит и
 * подложку, не только bump-амплитуду.
 */
function synthesize(
  luminance: Float64Array,
  width: number,
  height: number,
  radiusMeters: number,
  seed: number,
  bandLowKm: number,
  bandHighKm: number,
  baseAmplitudeMeters: number,
  bumpAmplitudeMeters: number
): { map: HeightMapData; slopeRgb: Uint8Array; rmsTan: number } {
  const params: SynthHeightParams = {
    widthTexels: width,
    heightTexels: height,
    radiusMeters,
    seed,
    baseAmplitudeMeters,
    bumpAmplitudeMeters,
    bandLowKm,
    bandHighKm,
    bumpSign: 1,
    raw: false
  }

  const { heights, minMeters, maxMeters } = buildSynthHeightField(luminance, params)
  const data = normalizeToUint16(Float32Array.from(heights), minMeters, maxMeters)
  const map: HeightMapData = { width, height, minMeters, maxMeters, data }
  const slopeRgb = buildSlopeMap(map, radiusMeters)

  return { map, slopeRgb, rmsTan: measureRmsTan(slopeRgb, width, height) }
}

/** Полная генерация одного тела: даунсемпл → автокалибровка → запись height+slope → строка отчёта. */
async function generateBody(body: BodyGeneration): Promise<ReportRow> {
  const ceilingWidth = resolutionCeiling(body.radiusMeters)
  const { width, height, luminance } = await loadDownsampledGreyscale(body.inputPath, ceilingWidth)

  const bandLowKm = bandLowKmFor(body.radiusMeters)
  const equatorTexelKm = (2 * Math.PI * body.radiusMeters) / width / 1000
  const bandHighKm = BAND_HIGH_TEXELS * equatorTexelKm
  const maxHeightBudgetMeters = HEIGHT_BUDGET_FRACTION * body.radiusMeters

  let last: { map: HeightMapData; slopeRgb: Uint8Array } | undefined

  const generate = (bumpAmplitudeMeters: number): CalibrationSample => {
    const result = synthesize(
      luminance,
      width,
      height,
      body.radiusMeters,
      body.seedActorId,
      bandLowKm,
      bandHighKm,
      BASE_AMPLITUDE_METERS,
      bumpAmplitudeMeters
    )
    last = { map: result.map, slopeRgb: result.slopeRgb }

    return { rmsTan: result.rmsTan, peakMeters: peakMetersOf(result.map) }
  }

  const calibration = autoCalibrateAmplitude(generate, REF_AMPLITUDE_METERS, TARGET_RMS_TAN, maxHeightBudgetMeters)

  // autoCalibrateAmplitude всегда зовёт generate минимум раз — last заполнен гарантированно
  if (!last) throw new Error(`Автокалибровка ${body.name}: колбэк ни разу не вызван`)

  let finalAmplitudeMeters = calibration.amplitudeMeters
  let finalRmsTan = calibration.rmsTan
  let finalPeakMeters = calibration.peakMeters
  let clamped = false

  // Пост-коррекция по фактическому пику поля (фикс-раунд 1, находка 1):
  // autoCalibrateAmplitude клампит только ПАРАМЕТР bump-амплитуды, подложка
  // (BASE_AMPLITUDE_METERS) в неё не входит — реальный max(|min|,|max|) может
  // превысить бюджет даже когда bump-амплитуда в рамках (типично для малых
  // тел: константная подложка — заметная доля их крошечного бюджета).
  // buildSynthHeightField однородна по паре амплитуд: heights[i] =
  // base·baseAmplitude + band[i]·bumpAmplitude — оба слагаемых линейны по
  // СВОЕЙ амплитуде без свободного члена, поэтому синхронный рескейл ОБЕИХ
  // на один и тот же коэффициент масштабирует min/max РОВНО на этот
  // коэффициент: одна повторная генерация точно возвращает пик на бюджет,
  // без итерационного поиска.
  if (finalPeakMeters > maxHeightBudgetMeters) {
    const rescale = maxHeightBudgetMeters / finalPeakMeters
    finalAmplitudeMeters = calibration.amplitudeMeters * rescale
    const rescaledBaseAmplitudeMeters = BASE_AMPLITUDE_METERS * rescale

    const result = synthesize(
      luminance,
      width,
      height,
      body.radiusMeters,
      body.seedActorId,
      bandLowKm,
      bandHighKm,
      rescaledBaseAmplitudeMeters,
      finalAmplitudeMeters
    )
    last = { map: result.map, slopeRgb: result.slopeRgb }
    finalRmsTan = result.rmsTan
    finalPeakMeters = peakMetersOf(result.map)
    clamped = true
  }

  const dir = path.dirname(body.inputPath)
  const heightPath = path.join(dir, `${body.name}_height.raw`)
  const slopePath = path.join(dir, `${body.name}_slope.webp`)

  await writeFile(heightPath, encodeHeightMap(last.map))
  await sharp(Buffer.from(last.slopeRgb.buffer), { raw: { width, height, channels: 3 } })
    .webp({ lossless: true, effort: 6 })
    .toFile(slopePath)

  return {
    name: body.name,
    actorIds: body.actorIds,
    inputPath: body.inputPath,
    inputKind: body.inputKind,
    width,
    height,
    amplitudeMeters: finalAmplitudeMeters,
    rmsTan: finalRmsTan,
    peakMeters: finalPeakMeters,
    budgetMeters: maxHeightBudgetMeters,
    minMeters: last.map.minMeters,
    maxMeters: last.map.maxMeters,
    clamped, // по фактическому пику (находка 1) — НЕ проброс calibration.clamped (тот про амплитуду-параметр)
    iterations: calibration.iterations,
    heightPath,
    slopePath,
    heightBytes: 24 + width * height * 2, // заголовок TEHM + uint16 тело
    slopeVramMiB: (width * height * 4 * (4 / 3)) / (1024 * 1024) // RGBA8 + мип-цепочка ×4/3
  }
}

async function run(): Promise<void> {
  const onlyName = argument('only')
  const selected = onlyName ? BODIES.filter((body) => body.name === onlyName) : BODIES

  if (onlyName && selected.length === 0) {
    console.error(`--only ${onlyName}: генерация не найдена. Доступные: ${BODIES.map((body) => body.name).join(', ')}`)
    process.exit(1)
  }

  const rows: ReportRow[] = []

  for (const body of selected) {
    console.log(`Генерация ${body.name} (${body.inputKind}: ${body.inputPath})…`)
    const row = await generateBody(body)
    rows.push(row)

    console.log(
      `  ${row.width}×${row.height}, амплитуда ${row.amplitudeMeters.toFixed(0)} м (${row.iterations} прогонов калибровки` +
        `${row.clamped ? ' + рескейл под пик' : ''}), RMS(tan) ${row.rmsTan.toFixed(4)}, ` +
        `пик ${row.peakMeters.toFixed(0)} м / бюджет ${row.budgetMeters.toFixed(0)} м` +
        `${row.clamped ? ' [КЛАМП: пик поля превышал бюджет — bump и подложка рескейлены]' : ''}, ` +
        `высоты ${row.minMeters.toFixed(0)}..${row.maxMeters.toFixed(0)} м`
    )
  }

  console.log('\nСводная таблица:')
  console.table(
    rows.map((row) => ({
      генерация: row.name,
      тело: row.actorIds.join(','),
      вход: row.inputKind,
      разрешение: `${row.width}×${row.height}`,
      'амплитуда, м': Math.round(row.amplitudeMeters),
      'RMS(tan)': row.rmsTan.toFixed(4),
      'пик, м': Math.round(row.peakMeters),
      'бюджет, м': Math.round(row.budgetMeters),
      'высоты, м': `${row.minMeters.toFixed(0)}..${row.maxMeters.toFixed(0)}`,
      'height, МиБ': (row.heightBytes / (1024 * 1024)).toFixed(2),
      'slope VRAM, МиБ': row.slopeVramMiB.toFixed(2),
      кламп: row.clamped ? 'да' : ''
    }))
  )

  // Каждая генерация теперь пишет СВОЙ физический файл (Корribан I-VII —
  // тоже, фикс-раунд 1, находка 2) — дедуп не нужен, прямая сумма по строкам.
  const totalSlopeVramMiB = rows.reduce((sum, row) => sum + row.slopeVramMiB, 0)
  const totalHeightMiB = rows.reduce((sum, row) => sum + row.heightBytes, 0) / (1024 * 1024)
  console.log(`\nИтого: slope VRAM ${totalSlopeVramMiB.toFixed(2)} МиБ, height CPU ${totalHeightMiB.toFixed(2)} МиБ`)

  console.log('\nПути для заливки в бакет (пара height+slope на генерацию):')
  for (const row of rows) {
    console.log(`  ${row.heightPath}`)
    console.log(`  ${row.slopePath}`)
  }
}

await run()
