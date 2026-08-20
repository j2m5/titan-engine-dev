import process from 'node:process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { terrainAuxPathFor } from '@/core/terrain/terrainAuxFormat'
import { AUX_BAKE_RADIUS_KM, encodeTerrainAux } from './lib/terrainAuxEncode'
import { terrainFloorStatus } from './lib/terrainFloorStatus'
import { Resources } from '@storage/database/resources'
import { ActorResource } from '@storage/database/actorResource'
import { Actors } from '@storage/database/actors'
import { Categories } from '@storage/database/categories'
import { RenderingObjects } from '@storage/database/renderingObjects'

/**
 * Пакетная сборка компаньонов карт высот — по одному на КАРТУ (см. докблок
 * `build-terrain-aux.ts`: что и зачем запекается).
 *
 * Охват выводится ПРОГРАММНО из БД, как у `rebuild-slopemaps.ts`: все строки
 * ресурсов типа `height`. Ключ обхода — путь карты, а не актор: одна карта
 * легально шарится несколькими телами (вымышленные луны разных радиусов на
 * общей карте), а компаньон радиуса не знает и знать не должен — иначе одна
 * и та же работа делалась бы по разу на тело.
 *
 * Идемпотентен: тот же вход даёт байт-в-байт тот же выход. Перезаписывает
 * существующие компаньоны на месте — так и надо после правки модели провиса
 * (`TERRAIN_SAG_MODEL_VERSION`): старые файлы рантайм всё равно отбросит по
 * калибровке, но до пересборки будет платить за это фризом.
 *
 * Запуск: npm run build:terrain-aux-all
 */

const TEXTURES_ROOT = 'storage/images/textures'

interface Job {
  readonly heightPath: string
  readonly auxPath: string
  /** Тела, делящие эту карту — только для лога: сама запечка о них не знает. */
  readonly owners: string[]
  /** Их id — для сверки объявленного пола рельефа у атмосфер (см. конец файла). */
  readonly ownerIds: number[]
}

const ownersByPath = new Map<string, { names: string[]; ids: number[] }>()

for (const link of ActorResource) {
  const resource = Resources.find((r) => r.id === link.resourceId)

  if (!resource || resource.resourceType !== 'height') continue

  const name = Actors.find((a) => a.id === link.actorId)?.name ?? `actor ${link.actorId}`
  const owners = ownersByPath.get(resource.path)

  if (owners) {
    owners.names.push(name)
    owners.ids.push(link.actorId)
  } else {
    ownersByPath.set(resource.path, { names: [name], ids: [link.actorId] })
  }
}

const coverage: Job[] = [...ownersByPath].map(([heightPath, owners]) => ({
  heightPath,
  auxPath: terrainAuxPathFor(heightPath),
  owners: owners.names,
  ownerIds: owners.ids
}))

const ownerCount = [...ownersByPath.values()].reduce((sum, owners) => sum + owners.names.length, 0)
console.log(`Карт высот в БД: ${coverage.length} (тел-владельцев: ${ownerCount})`)

if (coverage.length === 0) {
  console.error('СТОП: в БД не нашлось ни одной строки ресурса типа height — проверить БД, не подгонять')
  process.exit(1)
}

let built = 0
let skippedMissingFile = 0
let totalMillis = 0
let totalBytes = 0

/**
 * Сверка объявленного пола рельефа (`AtmosphereConfig.terrainFloorMeters`) с
 * фактическим минимумом карты. Едет вместе с запечкой намеренно: это
 * единственный прогон, который парсит заголовок КАЖДОЙ карты, а отдельный
 * скрипт ради одного числа перечитывал бы те же гигабайты. Копится здесь,
 * печатается в конце — см. секцию после итогов сборки.
 */
const floorReport: string[] = []
const atmosphereCategoryId = Categories.find((c) => c.alias === 'atmosphere')?.id

function checkTerrainFloors(job: Job, minMeters: number): void {
  if (atmosphereCategoryId === undefined) return

  for (const ownerId of job.ownerIds) {
    const atmosphere = Actors.find((a) => a.parentId === ownerId && a.categoryId === atmosphereCategoryId)

    if (!atmosphere) continue // тело без атмосферы — полу рельефа некому пригодиться

    const bodyName = Actors.find((a) => a.id === ownerId)?.name ?? `actor ${ownerId}`
    const data = RenderingObjects.find((r) => r.actorId === atmosphere.id)?.data as
      | { terrainFloorMeters?: unknown }
      | undefined

    const check = terrainFloorStatus(data?.terrainFloorMeters, minMeters)

    if (check.status === 'missing') {
      floorReport.push(`[НЕТ]  ${bodyName}: поставить terrainFloorMeters = ${check.expected}`)
    } else if (check.status === 'mismatch') {
      floorReport.push(`[РАЗОШЁЛСЯ] ${bodyName}: объявлено ${check.declared}, в карте ${check.expected}`)
    } else {
      floorReport.push(`[ок]   ${bodyName}: ${check.declared}`)
    }
  }
}

for (const job of coverage) {
  const inputPath = path.join(TEXTURES_ROOT, job.heightPath)
  const outputPath = path.join(TEXTURES_ROOT, job.auxPath)

  if (!existsSync(inputPath)) {
    console.log(`[skip] ${job.owners.join(', ')}: нет файла карты на диске — ${inputPath}`)
    skippedMissingFile++
    continue
  }

  const raw = await readFile(inputPath)
  const map = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)

  const startedAt = Date.now()
  const encoded = encodeTerrainAux(new TerrainHeightField(map, AUX_BAKE_RADIUS_KM).exportAux(), map)
  const millis = Date.now() - startedAt

  await writeFile(outputPath, encoded)

  checkTerrainFloors(job, map.minMeters)

  totalMillis += millis
  totalBytes += encoded.byteLength
  built++

  console.log(
    `[ok] ${job.owners.join(', ')}: ${map.width}×${map.height} → ${outputPath} ` +
      `(${(encoded.byteLength / 1024 / 1024).toFixed(2)} МиБ, ${millis} мс)`
  )
}

console.log(
  `Готово: собрано ${built} из ${coverage.length}, пропущено (нет файла) ${skippedMissingFile}. ` +
    `Снято с рантайма ${(totalMillis / 1000).toFixed(1)} с счёта, добавлено ${(totalBytes / 1024 / 1024).toFixed(1)} МиБ ассетов`
)

if (built + skippedMissingFile !== coverage.length) {
  throw new Error('внутренняя ошибка счётчиков: built + skippedMissingFile !== coverage.length')
}

// ── Пол рельефа у тел с атмосферой (см. докблок checkTerrainFloors) ──
if (floorReport.length > 0) {
  const problems = floorReport.filter((line) => !line.startsWith('[ок]'))

  console.log(`\nПол рельефа (AtmosphereConfig.terrainFloorMeters), тел с атмосферой: ${floorReport.length}`)
  for (const line of floorReport.sort()) console.log(`  ${line}`)

  if (problems.length > 0) {
    console.log(
      `\n${problems.length} тел(а) без сходящегося пола: без него дно атмосферы остаётся на опорной сфере,\n` +
        'и над низинами аналитический горизонт висит выше реального силуэта. Править в редакторе БД,\n' +
        'в data атмосферы тела.'
    )
  }
}
