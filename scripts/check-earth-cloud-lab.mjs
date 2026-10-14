import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withCloudProbeBrowser } from './lib/cloud-probe-browser.mjs'

if (process.argv.slice(2).some((arg) => arg !== '--probe=maps')) throw new Error('Supported probe: --probe=maps')
const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '../tmpscreenshots/earth-cloud-lab')
await mkdir(outputDir, { recursive: true })
const report = await withCloudProbeBrowser(
  {
    url: process.env.EARTH_CLOUD_PROBE_URL ?? 'http://127.0.0.1:8086/tests/clouds/earth/probe.html',
    outputDir
  },
  async ({ evaluate, webglErrors }) => {
    const maps = await evaluate(
      "import('/tests/clouds/earth/earthCloudTextures.gpu.ts').then(m => m.checkEarthCloudTextures())"
    )
    return { maps, webglErrors }
  }
)
await writeFile(resolve(outputDir, 'maps-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
