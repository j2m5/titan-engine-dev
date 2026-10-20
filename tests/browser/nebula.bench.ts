import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { benchmarkOptions, shuffled, summarizeGpuMs } from '../nebula/benchmarkSupport'

const modulePath = '/tests/nebula/nebulaBenchmark.browser.ts'
type Probe = typeof import('../nebula/nebulaBenchmark.browser')
type Row = Omit<Awaited<ReturnType<Probe['runCase']>>, 'preview'> & { round: number }

test('native nebula GPU cost across quality settings', async ({ page }, testInfo) => {
  const rows: Row[] = [], scenes: ReturnType<Probe['setup']>[] = []
  const controls: Awaited<ReturnType<Probe['control']>>[] = []
  const errors: string[] = [], warnings: string[] = []
  const directory = 'benchmark-results/nebula'
  const startedAt = new Date().toISOString()
  let options: ReturnType<typeof benchmarkOptions> | undefined
  let revision: string | undefined, enginePatch: string | undefined
  let failure: string | null = null, outcome = 'failed'
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
    if (message.type() === 'warning') warnings.push(message.text())
  })
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
  try {
    await mkdir(directory, { recursive: true })
    options = benchmarkOptions(process.env)
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
    // A local benchmark often runs before commit: HEAD alone cannot identify
    // the shader being timed. Preserve the scoped patch, not unrelated files.
    enginePatch = execFileSync('git', ['diff', 'HEAD', '--', 'src/core/renderables/Nebula',
      'src/core/graphic/passes/DepthVolume*', 'src/core/services/DepthVolumeRegistry.ts',
      'storage/database/renderingObjects.ts'], { encoding: 'utf8', windowsHide: true })
    await page.goto('/tests/browser/harness.html')
    for (const name of ['W26', 'Alkaid', 'Crab'] as const) {
      const scene = await page.evaluate(async ({ modulePath, name }) => {
        const probe: Probe = await import(/* @vite-ignore */ modulePath)
        return probe.setup(name, 1920, 1080)
      }, { modulePath, name })
      scenes.push(scene)
      const control = await page.evaluate(async ({ modulePath, options }) => {
        const probe: Probe = await import(/* @vite-ignore */ modulePath)
        return probe.control(options)
      }, { modulePath, options })
      controls.push(control)
      console.log(`${name}/depth-copy control: GPU p50=${control.gpuMs.p50.toFixed(3)} ms`)
      for (let round = 0; round < options.rounds; round++) {
        for (const item of shuffled(scene.cases, 2601 + round)) {
          const { preview, ...row } = await page.evaluate(async ({ modulePath, item, options, preview }) => {
            const probe: Probe = await import(/* @vite-ignore */ modulePath)
            return probe.runCase(item, options, preview)
          }, { modulePath, item, options, preview: round === 0 && item.view === 'close' })
          rows.push({ round, ...row })
          if (preview) await writeFile(`${directory}/${name}-${item.profile.name}.png`, Buffer.from(preview.split(',')[1], 'base64'))
          console.log(`${name}/${item.view}/${item.profile.name} round ${round + 1}: GPU p50=${row.gpuMs.p50.toFixed(3)} p95=${row.gpuMs.p95.toFixed(3)} ms`)
          expect(errors, 'Browser/GL errors invalidate timing results').toEqual([])
        }
      }
      await page.evaluate(async modulePath => { const probe: Probe = await import(/* @vite-ignore */ modulePath); probe.dispose() }, modulePath)
    }
    outcome = 'passed'
  } catch (error) {
    failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    const keys = [...new Set(rows.map(row => `${row.scene}/${row.view}/${row.profile}`))]
    const summary = keys.map(key => ({
      case: key, gpuMs: summarizeGpuMs(rows.filter(row => `${row.scene}/${row.view}/${row.profile}` === key).flatMap(row => row.samples))
    }))
    const report = {
      startedAt, finishedAt: new Date().toISOString(), outcome, failure,
      revision, enginePatch,
      options, scenes, controls, rows, summary, errors, warnings,
      method: 'Vite development; production DepthVolumePass only (depth copy + raymarch + reconstruction + temporal resolve). RGBA16F, no MSAA, baked RG8 fields at database resolution. Pure raymarch, empty opaque depth, normalized outer size=1. FOV50, near0.01/far100; orbit angle=frame*0.001, close radius/y=1.42/1.42, inside=0.2/0.08. Same path per case; warmup excluded, deterministic shuffled order per round. Native asynchronous elapsed GPU queries, max8 pending; any disjoint invalidates run. Nearest-rank quantiles, no trimming. Baking, compilation, scene preparation and readback excluded. Not application FPS, CPU time, VRAM measurement or a universal hardware budget.'
    }
    const json = JSON.stringify(report, null, 2)
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}/report.json`, json)
    await testInfo.attach('nebula-native-gpu', { body: json, contentType: 'application/json' })
  }
})
