import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withCloudProbeBrowser } from './lib/cloud-probe-browser.mjs'

const args = process.argv.slice(2)
if (
  args.length > 1 ||
  args.some((arg) => !/^--probe=(maps|depth|lighting|receivers|pipeline|lifecycle|flight|all)$/.test(arg))
)
  throw new Error('Supported probes: maps, depth, lighting, receivers, pipeline, lifecycle, flight, all')
const probe = args[0]?.split('=')[1] ?? 'all'
const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '../tmpscreenshots/scene-clouds')
await mkdir(outputDir, { recursive: true })
const pageUrl = process.env.SCENE_CLOUD_PROBE_URL ?? 'http://127.0.0.1:8086/tests/clouds/scene/probe.html'
const report = await withCloudProbeBrowser({ url: pageUrl, outputDir }, async ({ evaluate, webglErrors }) => {
  const names =
    probe === 'all'
      ? await evaluate("import('/tests/clouds/scene/probe.ts').then(m => Object.keys(m.sceneCloudProbeRegistry))")
      : [probe]
  if (!names.length) throw new Error('No scene cloud probes registered')
  const probes = {}
  for (const name of names)
    probes[name] = await evaluate(
      `import('/tests/clouds/scene/probe.ts').then(m => m.runSceneCloudProbe(${JSON.stringify(name)}))`
    )
  return { probes, webglErrors }
})
await writeFile(resolve(outputDir, `${probe}-report.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
