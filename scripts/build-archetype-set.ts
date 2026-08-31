import process from 'node:process'
import sharp from 'sharp'
import { argument } from './lib/cliArguments'

/**
 * Конвертация набора ambientCG в детальную тройку архетипа грунта
 * `terrain/<prefix>_{diff,nor,arm}.webp` (формат — по образцу `rocky_trail_*`):
 * diff — Color, q90, sRGB; nor — NormalGL, lossless; arm — сборка R:AO,
 * G:Roughness, B:0 (metallic у грунтов нулевой; терраформный шейдер читает
 * из ARM только R, но формат общий с наборами астероидов), q90.
 *
 * Запуск: npm run build:archetype-set -- --src <dir ambientCG> --name <AssetId> --prefix <archetype>
 *   [--out storage/images/textures/terrain]
 *
 * Примеры (арка sand/volcanic, 2026-08-31):
 *   npm run build:archetype-set -- --src tmpscreenshots/Ground079L_2K-JPG --name Ground079L --prefix sand
 *   npm run build:archetype-set -- --src tmpscreenshots/Rock058_2K-JPG --name Rock058 --prefix volcanic
 *
 * Набор с замесом двух источников (ice) собирает свой скрипт `build:ice-archetype`.
 */

const SIZE = 2048

const srcDir = argument('src')
const assetName = argument('name')
const prefix = argument('prefix')
const outDir = argument('out') ?? 'storage/images/textures/terrain'

if (!srcDir || !assetName || !prefix) {
  console.error('Нужны --src <dir>, --name <AssetId ambientCG> и --prefix <archetype>')
  process.exit(1)
}

const input = (kind: string): string => `${srcDir}/${assetName}_2K-JPG_${kind}.jpg`

async function grey(file: string): Promise<Uint8Array> {
  const { data, info } = await sharp(file).greyscale().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true })
  // sharp может развернуть серый jpeg в 3 канала — индексация без шага молча читала бы мусор (урок ice-арки)
  if (info.channels !== 1 || info.width !== SIZE || info.height !== SIZE) {
    throw new Error(`${file}: ожидался 1 канал ${SIZE}², получено ${info.channels} каналов ${info.width}×${info.height}`)
  }
  return data
}

const colorMeta = await sharp(input('Color')).metadata()
if (colorMeta.width !== SIZE || colorMeta.height !== SIZE) {
  console.error(`Color должен быть ${SIZE}², получено ${colorMeta.width}×${colorMeta.height}`)
  process.exit(1)
}

await sharp(input('Color')).webp({ quality: 90 }).toFile(`${outDir}/${prefix}_diff.webp`)
await sharp(input('NormalGL')).webp({ lossless: true }).toFile(`${outDir}/${prefix}_nor.webp`)

const ao = await grey(input('AmbientOcclusion'))
const rough = await grey(input('Roughness'))
const arm = Buffer.alloc(SIZE * SIZE * 3)
for (let i = 0; i < SIZE * SIZE; i++) {
  arm[i * 3] = ao[i]
  arm[i * 3 + 1] = rough[i]
  arm[i * 3 + 2] = 0
}
await sharp(arm, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: 90 }).toFile(`${outDir}/${prefix}_arm.webp`)

console.log(`записано ${outDir}/${prefix}_{diff,nor,arm}.webp из ${assetName}`)
