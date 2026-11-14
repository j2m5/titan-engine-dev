import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { argument } from './lib/cliArguments'
import { measureDetailStats } from './lib/detailTextureStats'

// Poly Haven Cliff Side, CC0. Source URLs and credits: docs/terrain-quality-2026-11-12.md.
// npm run build:cliff-set -- --src <directory of the original 2K files> [--out <directory>]
const src = argument('src')
if (!src) throw new Error('Нужен --src <каталог исходных файлов Cliff Side 2K>')
const out = argument('out') ?? 'storage/images/textures/terrain'
const inputs = [
  { source: 'cliff_side_diff_2k.jpg', kind: 'diff', md5: '6d129836144e271b30071281241e237d' },
  { source: 'cliff_side_nor_gl_2k.png', kind: 'nor', md5: 'aa0ef88ce6aa5c31e0f32d3c2ae72675' },
  { source: 'cliff_side_arm_2k.jpg', kind: 'arm', md5: '124bf28fe0bb3733901c7d4bfcf7a13d' }
] as const

// Validate all sources before writing any runtime map. MD5 matches the publisher's file manifest.
const sources = await Promise.all(inputs.map(async input => {
  const data = await readFile(join(src, input.source))
  if (createHash('md5').update(data).digest('hex') !== input.md5) throw new Error(`Не совпал checksum ${input.source}`)
  const metadata = await sharp(data).metadata()
  if (metadata.width !== 2048 || metadata.height !== 2048) throw new Error(`Ожидалась карта 2048²: ${input.source}`)
  return { ...input, data }
}))
await mkdir(out, { recursive: true })
for (const { data, kind } of sources) {
  await sharp(data).webp(kind === 'nor' ? { lossless: true } : { quality: 90 }).toFile(join(out, `cliff_side_${kind}.webp`))
}
const diffuse = await measureDetailStats(join(out, 'cliff_side_diff.webp'))
const arm = await measureDetailStats(join(out, 'cliff_side_arm.webp'))
console.log({ out, meanLum: diffuse.meanLum, meanAo: arm.meanAo })
