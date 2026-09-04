import process from 'node:process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { argument } from './lib/cliArguments'
import { buildShapeTiers, centerAndNormalize, parseShapeMesh } from './lib/shapeModel'
import { encodeShapeModel, shapeModelPath } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'

/**
 * Реальные модели форм малых тел → бинарники архетипов кольца
 * `asteroids/shapes/<имя>_{l0,near}.bin` (формат — ShapeModelFormat).
 *
 * Вход: папка с моделями из открытых архивов — Wavefront OBJ или табличные
 * plate-модели PDS (`nv nf` + вершины + грани). Имя архетипа — имя файла без
 * расширения в нижнем регистре; оно же пишется в профиль породы
 * (AsteroidProfiles.shapeModels). Каждая модель центрируется по объёмному
 * центроиду, нормируется на максимальный радиус 1 и режется до двух ярусов
 * (см. TIER_TRIANGLES). Сеть скрипт не трогает: модели качает владелец.
 *
 * Запуск: npm run build:shape-models -- --src <dir> [--out storage/images/textures]
 *
 * Атрибуция: модели PDS SBN — public domain (NASA), модели DAMIT — CC BY 4.0;
 * список источников ведётся вручную в storage/images/textures/asteroids/shapes/SOURCES.md.
 */
const srcDir = argument('src')
const outRoot = argument('out') ?? 'storage/images/textures'
if (!srcDir) {
  console.error('Нужен --src <dir> с моделями (.obj / .tab / .txt / .plt)')
  process.exit(1)
}

const SUPPORTED = new Set(['.obj', '.tab', '.txt', '.plt', '.dat'])
const files = readdirSync(srcDir).filter((f) => SUPPORTED.has(path.extname(f).toLowerCase()))
if (files.length === 0) {
  console.error(`В ${srcDir} нет моделей с расширениями ${[...SUPPORTED].join(', ')}`)
  process.exit(1)
}

for (const file of files) {
  const name = path.basename(file, path.extname(file)).toLowerCase()
  const text = readFileSync(path.join(srcDir, file), 'utf8')
  const mesh = parseShapeMesh(text)
  const positions = centerAndNormalize(mesh)
  const tiers = buildShapeTiers(positions, Uint32Array.from(mesh.indices))

  for (const tier of ['l0', 'near'] as const) {
    const relative = shapeModelPath(name, tier)
    const target = path.join(outRoot, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    const data = tiers[tier]
    writeFileSync(target, Buffer.from(encodeShapeModel(data)))
    console.log(
      `${relative}: ${data.positions.length / 3} вершин, ${data.indices.length / 3} треугольников` +
        (existsSync(target) ? '' : ' (не записан!)')
    )
  }
}
