import process from 'node:process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { terrainAuxPathFor } from '@/core/terrain/terrainAuxFormat'
import { AUX_BAKE_RADIUS_KM, encodeTerrainAux } from './lib/terrainAuxEncode'
import { Resources } from '@storage/database/resources'
import { ActorResource } from '@storage/database/actorResource'
import { Actors } from '@storage/database/actors'

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
}

const ownersByPath = new Map<string, string[]>()

for (const link of ActorResource) {
  const resource = Resources.find((r) => r.id === link.resourceId)

  if (!resource || resource.resourceType !== 'height') continue

  const name = Actors.find((a) => a.id === link.actorId)?.name ?? `actor ${link.actorId}`
  const owners = ownersByPath.get(resource.path)

  if (owners) owners.push(name)
  else ownersByPath.set(resource.path, [name])
}

const coverage: Job[] = [...ownersByPath].map(([heightPath, owners]) => ({
  heightPath,
  auxPath: terrainAuxPathFor(heightPath),
  owners
}))

console.log(`Карт высот в БД: ${coverage.length} (тел-владельцев: ${[...ownersByPath.values()].flat().length})`)

if (coverage.length === 0) {
  console.error('СТОП: в БД не нашлось ни одной строки ресурса типа height — проверить БД, не подгонять')
  process.exit(1)
}

let built = 0
let skippedMissingFile = 0
let totalMillis = 0
let totalBytes = 0

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
