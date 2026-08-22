import process from 'node:process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { buildSlopeMap, countClampedTexels } from './lib/slopeMapEncode'
import { slopeStatistics } from './lib/slopeStats'
import { slopeRangeForPath } from './lib/slopeRangeFromDb'
import { recommendSlopeRange } from '@/core/terrain/slopeMapFormat'
import { Resources } from '@storage/database/resources'
import { ActorResource } from '@storage/database/actorResource'
import { PhysicalObjects } from '@storage/database/physicalObjects'
import { Actors } from '@storage/database/actors'
import { RenderingObjects } from '@storage/database/renderingObjects'
import { WATER_SHALLOW_RANGE_METERS } from '@/core/terrain/waterLevel'

/**
 * Пересборка slope-карт терраформного охвата: канал B (cavity) появился в
 * encode позже самих файлов, а диапазон уклона (`slopeRange`) — per-map
 * величина из БД, а не общая константа — все существующие slope-карты нужно
 * перегенерировать под актуальную схему.
 *
 * Охват выводится ПРОГРАММНО из БД, а не хардкодится: все акторы с
 * height-ресурсом (`resourceType === 'height'`, путь оканчивается на
 * `_height.raw`) — включая фотомозаичные {5, 6, 8, 19} (Меркурий, Венера,
 * Марс, Луна — реальные DEM с фотомозаики поверхности): им cavity не
 * полагается, но per-map диапазон уклона требует пересборки и их карт тоже.
 * Логика энкодинга та же, что у CLI `build-slopemap.ts`
 * (`buildSlopeMap(map, radiusMeters, { cavity, slopeRange })`), но радиус и
 * пути берутся из `storage/database` (physicalObjects/resources/actorResource),
 * а не из флагов — перезаписывает существующий slope-файл каждого тела на
 * месте. Идемпотентен: один и тот же вход при повторном прогоне даёт
 * байт-в-байт тот же выход (buildSlopeMap детерминирован).
 *
 * `physicalObjects.radius` — в километрах (см. конвенцию `radiusKm` по
 * коду движка и хардкод-значения в `batch-synth-heightmaps.ts`), buildSlopeMap
 * ждёт метры — конвертируется здесь.
 *
 * Режим `--recommend`: для каждой карты печатает перцентили уклона и
 * рекомендованный `slopeRange` из сетки, файлы не пишет — используется до
 * заполнения `slopeRange` в БД (см. `slopeRangeFromDb.ts`), в обычном режиме
 * его отсутствие в строке ресурса — ошибка, не тихий дефолт.
 *
 * Запуск: npm run build:slopemaps-all [-- --recommend]
 */

/**
 * Тела охвата, которым cavity НЕ полагается: реальный DEM вместо синтетики.
 * Фотомозаичные {5,6,8,19} — реальный рельеф, синтетика ему не идёт; Земля
 * (7) пересобирается с каналом воды, но cavity off, как в её задокументированной
 * команде.
 */
const NO_CAVITY_ACTOR_IDS: readonly number[] = [5, 6, 7, 8, 19]

const EXPECTED_COVERAGE_COUNT = 50
const TEXTURES_ROOT = 'storage/images/textures'
const RECOMMEND_MODE = process.argv.includes('--recommend')

interface Job {
  readonly actorId: number
  readonly name: string
  readonly heightPath: string
  readonly slopePath: string
  readonly slopeResourceId: number
  readonly radiusMeters: number
  /** Уровень воды тела из renderingObjects; undefined — тело без воды, выход 3-канальный. */
  readonly waterLevelMeters: number | undefined
}

const heightPathByActor = new Map<number, string>()
const slopeResourceByActor = new Map<number, { id: number; path: string }>()

for (const link of ActorResource) {
  const resource = Resources.find((r) => r.id === link.resourceId)

  if (!resource) continue

  if (resource.resourceType === 'height' && resource.path.endsWith('_height.raw')) {
    heightPathByActor.set(link.actorId, resource.path)
  } else if (resource.resourceType === 'slope') {
    slopeResourceByActor.set(link.actorId, { id: resource.id, path: resource.path })
  }
}

const coverage: Job[] = []
const skippedNoSlopeResource: number[] = []
const skippedNoPhysicalObject: number[] = []

for (const [actorId, heightPath] of heightPathByActor) {
  const slopeResource = slopeResourceByActor.get(actorId)

  if (!slopeResource) {
    skippedNoSlopeResource.push(actorId)
    continue
  }

  const physicalObject = PhysicalObjects.find((p) => p.actorId === actorId)

  if (!physicalObject) {
    skippedNoPhysicalObject.push(actorId)
    continue
  }

  const name = Actors.find((a) => a.id === actorId)?.name ?? `actor ${actorId}`

  const data = RenderingObjects.find((r) => r.actorId === actorId)?.data as { waterLevelMeters?: unknown } | undefined
  const level = data?.waterLevelMeters
  const waterLevelMeters = typeof level === 'number' && Number.isFinite(level) ? level : undefined

  coverage.push({
    actorId,
    name,
    heightPath,
    slopePath: slopeResource.path,
    slopeResourceId: slopeResource.id,
    radiusMeters: physicalObject.radius * 1000,
    waterLevelMeters
  })
}

if (skippedNoSlopeResource.length > 0) {
  console.log(`Без slope-ресурса в БД, пропущены (${skippedNoSlopeResource.length}): [${skippedNoSlopeResource.join(', ')}]`)
}
if (skippedNoPhysicalObject.length > 0) {
  console.log(`Без physicalObject, пропущены (${skippedNoPhysicalObject.length}): [${skippedNoPhysicalObject.join(', ')}]`)
}
console.log(`Охват (терраформные тела): ${coverage.length}`)

if (coverage.length !== EXPECTED_COVERAGE_COUNT) {
  console.error(
    `СТОП: ожидалось ровно ${EXPECTED_COVERAGE_COUNT} тел охвата, получено ${coverage.length} — проверить БД, не подгонять`
  )
  process.exit(1)
}

if (RECOMMEND_MODE) {
  const recommendations: { job: Job; slopeRange: number }[] = []

  for (const job of coverage) {
    const inputPath = path.join(TEXTURES_ROOT, job.heightPath)

    if (!existsSync(inputPath)) {
      console.log(`[skip] ${job.name} (actorId ${job.actorId}): нет height-файла на диске — ${inputPath}`)
      continue
    }

    const raw = await readFile(inputPath)
    const map = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
    const stats = slopeStatistics(map, job.radiusMeters)
    const slopeRange = recommendSlopeRange(stats.p999)

    console.log(
      `${job.name}: p50 ${stats.p50.toFixed(4)} p90 ${stats.p90.toFixed(4)} p99 ${stats.p99.toFixed(4)} ` +
        `p99.9 ${stats.p999.toFixed(4)} max ${stats.max.toFixed(4)} → slopeRange ${slopeRange}`
    )
    recommendations.push({ job, slopeRange })
  }

  console.log('\n// для переноса в storage/database/resources.ts')
  for (const { job, slopeRange } of recommendations) {
    console.log(`{ id: ${job.slopeResourceId}, slopeRange: ${slopeRange} } // ${job.slopePath}`)
  }

  process.exit(0)
}

let rebuilt = 0
let skippedMissingFile = 0

for (const job of coverage) {
  const inputPath = path.join(TEXTURES_ROOT, job.heightPath)
  const outputPath = path.join(TEXTURES_ROOT, job.slopePath)

  if (!existsSync(inputPath)) {
    console.log(`[skip] ${job.name} (actorId ${job.actorId}): нет height-файла на диске — ${inputPath}`)
    skippedMissingFile++
    continue
  }

  const raw = await readFile(inputPath)
  const map = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
  const slopeRange = slopeRangeForPath(job.slopePath, Resources)
  // Вода и cavity — из данных тела, а не безусловно: прогон без уровня снял бы
  // канал A у Земли и Явина IV (мелководье и урез исчезли бы, а USE_WATER_DEPTH
  // остался бы взведён), а cavity у Земли противоречит её же команде сборки.
  const encoded = buildSlopeMap(map, job.radiusMeters, {
    cavity: !NO_CAVITY_ACTOR_IDS.includes(job.actorId),
    waterLevelMeters: job.waterLevelMeters,
    shallowRangeMeters: job.waterLevelMeters !== undefined ? WATER_SHALLOW_RANGE_METERS : undefined,
    slopeRange
  })

  // Число каналов — по фактическому буферу, как в build-slopemap.ts.
  const channels = (encoded.length / (map.width * map.height)) as 3 | 4
  const image = sharp(Buffer.from(encoded.buffer), { raw: { width: map.width, height: map.height, channels } })

  // exact — см. докблок в build-slopemap.ts: без него RGB суши обнуляется.
  await image.webp({ lossless: true, effort: 6, exact: true }).toFile(outputPath)

  const { clamped, total } = countClampedTexels(map, job.radiusMeters, slopeRange)
  const clampedFraction = clamped / total

  if (clampedFraction > 0.001) {
    const stats = slopeStatistics(map, job.radiusMeters)
    console.log(
      `[КЛАМП] ${job.name}: ${(100 * clampedFraction).toFixed(3)} % текселей за ${slopeRange}, ` +
        `рекомендация ${recommendSlopeRange(stats.p999)}`
    )
  }

  console.log(
    `[ok] ${job.name} (actorId ${job.actorId}): ${map.width}×${map.height}, радиус ${job.radiusMeters} м, ` +
      `slopeRange ${slopeRange} → ${outputPath}`
  )
  rebuilt++
}

console.log(`Готово: пересобрано ${rebuilt} из ${coverage.length}, пропущено (нет файла на диске) ${skippedMissingFile}`)

if (rebuilt + skippedMissingFile !== coverage.length) {
  throw new Error('внутренняя ошибка счётчиков: rebuilt + skippedMissingFile !== coverage.length')
}
