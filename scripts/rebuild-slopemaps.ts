import process from 'node:process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { buildSlopeMap } from './lib/slopeMapEncode'
import { Resources } from '@storage/database/resources'
import { ActorResource } from '@storage/database/actorResource'
import { PhysicalObjects } from '@storage/database/physicalObjects'
import { Actors } from '@storage/database/actors'

/**
 * Пересборка slope-карт терраформного охвата (арка cavity-канала, Task 3):
 * канал B (cavity) появился в encode позже самих файлов — все существующие
 * slope-карты нужно перегенерировать, чтобы он не остался нулевым.
 *
 * Охват выводится ПРОГРАММНО из БД, а не хардкодится: все акторы с
 * height-ресурсом (`resourceType === 'height'`, путь оканчивается на
 * `_height.raw`), КРОМЕ фотомозаичных {5, 6, 8, 19} (Меркурий, Венера, Марс,
 * Луна — реальные DEM с фотомозаики поверхности, cavity им по брифу задачи
 * не полагается). Логика энкодинга та же, что у CLI `build-slopemap.ts`
 * (`buildSlopeMap(map, radiusMeters, { cavity: true })`), но радиус и пути
 * берутся из `storage/database` (physicalObjects/resources/actorResource),
 * а не из флагов — перезаписывает существующий slope-файл каждого тела на
 * месте. Идемпотентен: один и тот же вход при повторном прогоне даёт
 * байт-в-байт тот же выход (buildSlopeMap детерминирован).
 *
 * `physicalObjects.radius` — в километрах (см. конвенцию `radiusKm` по
 * коду движка и хардкод-значения в `batch-synth-heightmaps.ts`), buildSlopeMap
 * ждёт метры — конвертируется здесь.
 *
 * Запуск: npm run build:slopemaps-all
 */

const PHOTOMOSAIC_ACTOR_IDS: readonly number[] = [5, 6, 8, 19]
const EXPECTED_COVERAGE_COUNT = 44
const TEXTURES_ROOT = 'storage/images/textures'

interface Job {
  readonly actorId: number
  readonly name: string
  readonly heightPath: string
  readonly slopePath: string
  readonly radiusMeters: number
}

const heightPathByActor = new Map<number, string>()
const slopePathByActor = new Map<number, string>()

for (const link of ActorResource) {
  const resource = Resources.find((r) => r.id === link.resourceId)

  if (!resource) continue

  if (resource.resourceType === 'height' && resource.path.endsWith('_height.raw')) {
    heightPathByActor.set(link.actorId, resource.path)
  } else if (resource.resourceType === 'slope') {
    slopePathByActor.set(link.actorId, resource.path)
  }
}

const coverage: Job[] = []
const skippedPhotomosaic: number[] = []
const skippedNoSlopeResource: number[] = []
const skippedNoPhysicalObject: number[] = []

for (const [actorId, heightPath] of heightPathByActor) {
  if (PHOTOMOSAIC_ACTOR_IDS.includes(actorId)) {
    skippedPhotomosaic.push(actorId)
    continue
  }

  const slopePath = slopePathByActor.get(actorId)

  if (!slopePath) {
    skippedNoSlopeResource.push(actorId)
    continue
  }

  const physicalObject = PhysicalObjects.find((p) => p.actorId === actorId)

  if (!physicalObject) {
    skippedNoPhysicalObject.push(actorId)
    continue
  }

  const name = Actors.find((a) => a.id === actorId)?.name ?? `actor ${actorId}`

  coverage.push({ actorId, name, heightPath, slopePath, radiusMeters: physicalObject.radius * 1000 })
}

console.log(`Фотомозаичные пропущены (${skippedPhotomosaic.length}): [${skippedPhotomosaic.sort((a, b) => a - b).join(', ')}]`)
if (skippedNoSlopeResource.length > 0) {
  console.log(`Без slope-ресурса в БД, пропущены (${skippedNoSlopeResource.length}): [${skippedNoSlopeResource.join(', ')}]`)
}
if (skippedNoPhysicalObject.length > 0) {
  console.log(`Без physicalObject, пропущены (${skippedNoPhysicalObject.length}): [${skippedNoPhysicalObject.join(', ')}]`)
}
console.log(`Охват (терраформные тела минус фотомозаичные): ${coverage.length}`)

if (coverage.length !== EXPECTED_COVERAGE_COUNT) {
  console.error(
    `СТОП: ожидалось ровно ${EXPECTED_COVERAGE_COUNT} тел охвата, получено ${coverage.length} — проверить БД, не подгонять`
  )
  process.exit(1)
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
  const rgb = buildSlopeMap(map, job.radiusMeters, { cavity: true })

  const image = sharp(Buffer.from(rgb.buffer), { raw: { width: map.width, height: map.height, channels: 3 } })

  await image.webp({ lossless: true, effort: 6 }).toFile(outputPath)

  console.log(
    `[ok] ${job.name} (actorId ${job.actorId}): ${map.width}×${map.height}, радиус ${job.radiusMeters} м → ${outputPath}`
  )
  rebuilt++
}

console.log(`Готово: пересобрано ${rebuilt} из ${coverage.length}, пропущено (нет файла на диске) ${skippedMissingFile}`)

if (rebuilt + skippedMissingFile !== coverage.length) {
  throw new Error('внутренняя ошибка счётчиков: rebuilt + skippedMissingFile !== coverage.length')
}
