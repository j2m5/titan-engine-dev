import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { gaiaTileByteLength, gaiaTiles, type GaiaTile } from '@/core/sky/gaiaTiles'

/**
 * Скачивание тайлов неба Gaia с сайта Брунетона в локальное хранилище.
 *
 * Запуск: npm run fetch:gaia-sky
 *
 * Тайлы без лицензии на перераспространение: только локально. Папка под
 * правилом .gitignore `**\/textures/`; в бакет и манифест не заливать.
 * Файлы нужной длины пропускаются — повторный запуск докачивает недостающее
 */
const SOURCE = 'https://ebruneton.github.io/gaia_sky_map'
const TARGET = path.resolve('public/images/textures/sky/gaia')
const CONCURRENCY = 6

async function hasTile(file: string, length: number): Promise<boolean> {
  try {
    return (await stat(file)).size === length
  } catch {
    return false
  }
}

async function fetchTile(tile: GaiaTile): Promise<boolean> {
  const file = path.join(TARGET, `${tile.name}.dat`)
  const length = gaiaTileByteLength(tile)
  if (await hasTile(file, length)) return false
  const response = await fetch(`${SOURCE}/${tile.name}.dat`)
  if (!response.ok) throw new Error(`${tile.name}: HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength !== length) throw new Error(`${tile.name}: ${data.byteLength} байт вместо ${length}`)
  await writeFile(file, data)
  return true
}

await mkdir(TARGET, { recursive: true })
const tiles = gaiaTiles()
const failures: string[] = []
let next = 0
let fetched = 0
let skipped = 0

async function worker(): Promise<void> {
  while (next < tiles.length) {
    const tile = tiles[next++]
    try {
      if (await fetchTile(tile)) fetched++
      else skipped++
    } catch (error) {
      failures.push(String(error))
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`скачано ${fetched}, уже было ${skipped}, ошибок ${failures.length}`)
for (const failure of failures) console.error(failure)
if (failures.length > 0) process.exit(1)
