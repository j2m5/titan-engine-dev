import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { terrainAuxPathFor } from '@/core/terrain/terrainAuxFormat'
import { AUX_BAKE_RADIUS_KM, encodeTerrainAux } from './lib/terrainAuxEncode'
import { argument } from './lib/cliArguments'

/**
 * Сборка компаньона карты высот: `<карта>.raw` → `<карта>.aux` (контейнер
 * 'TEHA', см. `src/core/terrain/terrainAuxFormat.ts`).
 *
 * Зачем. Конструктор `TerrainHeightField` считает сетку провиса, ε-пирамиду
 * уровней и пирамиду честных максимумов узлов за проход по всей карте —
 * порядка секунды на 8192×4096. С гейтом карт высот этот проход исполняется
 * не на старте, а в кадре, когда тело доросло до порога загрузки: подлёт к
 * планете стоит фриза главного потока. Всё посчитанное — чистая функция от
 * байтов карты, поэтому считается здесь, один раз при сборке ассета.
 *
 * Формулы НЕ ДУБЛИРУЮТСЯ: скрипт строит настоящее поле и забирает у него
 * готовые блоки (`exportAux`), поэтому запечённое равно вычисленному по
 * построению. Радиус тела условный (`AUX_BAKE_RADIUS_KM`) — ни одна
 * запечённая величина от него не зависит, см. докблок константы.
 *
 * Исходный DEM не нужен: компаньон считается из уже собранного `.raw`, так
 * что миграция существующих 50 карт — прогон `build:terrain-aux-all`, а не
 * пересборка ассетов.
 *
 * Запуск: npm run build:terrain-aux -- --in <файл .raw> [--out <файл .aux>]
 * Без --out путь выводится из входного тем же правилом, что в рантайме
 * (`terrainAuxPathFor`), — чтобы файл лёг туда, где его будут искать.
 */
const input: string | undefined = argument('in')

if (!input) {
  console.error('Нужен --in <файл .raw>')
  process.exit(1)
}

const output: string = argument('out') ?? terrainAuxPathFor(input)

const raw = await readFile(input)
const map = parseHeightMap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)

const startedAt = Date.now()
const field = new TerrainHeightField(map, AUX_BAKE_RADIUS_KM)
const encoded = encodeTerrainAux(field.exportAux(), map)

await writeFile(output, encoded)

console.log(
  `[ok] ${input} (${map.width}×${map.height}) → ${output}: ` +
    `${(encoded.byteLength / 1024 / 1024).toFixed(2)} МиБ, ${Date.now() - startedAt} мс счёта снято с рантайма`
)
