import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import sharp from 'sharp'
import { createTitanCloudCoverage, TITAN_CLOUD_PATH, TITAN_CLOUD_SEED } from './lib/titanCloudCoverage'

// Fixed recipe: npm run build:titan-clouds. Generation is never imported by the renderer.
const { data, width, height } = createTitanCloudCoverage()
const output = path.join('storage/images/textures', TITAN_CLOUD_PATH)
await mkdir(path.dirname(output), { recursive: true })
const png = await sharp(data, { raw: { width, height, channels: 1 } })
  .toColourspace('b-w')
  .png({ compressionLevel: 9 })
  .toBuffer()
await writeFile(output, png)
console.log(
  JSON.stringify({
    output,
    width,
    height,
    seed: TITAN_CLOUD_SEED,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex')
  })
)
