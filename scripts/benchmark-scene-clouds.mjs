import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { withCloudProbeBrowser } from './lib/cloud-probe-browser.mjs'
import { parseCloudBenchmarkOptions } from './lib/scene-cloud-benchmark.mjs'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log(`Usage: npm run benchmark:clouds -- [options]
  --quality=all|low|medium|high       default all
  --view=all|above|inside            default all (Earth, day, fixed cloud edge)
  --stage=all|cloud-current|cloud-resolve|shadows|depth|frame
  --samples=512                     multiple of 64, range 64..4096
  --repeats=2                       range 1..10; each interval reported separately
  --width=1920 --height=1080         CSS viewport at DPR 1, max 7680 each
Starts and closes its own local Vite server and Chromium browser (CHROME_BIN supported).
Reports and screenshots: benchmark-results/scene-clouds/<unique run>/.
No performance pass/fail threshold. Stage intervals are independent, not additive.`)
} else {
  const options = parseCloudBenchmarkOptions(args)
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const parent = resolve(root, 'benchmark-results/scene-clouds')
  await mkdir(parent, { recursive: true })
  const outputDir = await mkdtemp(resolve(parent, `${new Date().toISOString().replace(/[:.]/g, '-')}-`))
  const save = (name, data) => writeFile(resolve(outputDir, `${name}.json`), JSON.stringify(data, null, 2))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const report = {
    schemaVersion: 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    options,
    source: {
      commit: git('rev-parse', 'HEAD'),
      status: git(
        'status',
        '--porcelain',
        '--untracked-files=normal',
        '--',
        'src',
        'tests',
        'scripts',
        'package.json',
        'package-lock.json',
        'vite.config.ts'
      )
    },
    methodology: {
      warmupFrames: 64,
      stableFramesBeforeCase: 120,
      noisePhases: 64,
      timer: 'EXT_disjoint_timer_query_webgl2',
      units: 'milliseconds',
      stages: {
        'cloud-current': 'Clouds currentPass.render (packed raymarch draw and unpack)',
        'cloud-resolve': 'Clouds resolvePass.render',
        shadows: 'ShadowPass.update (all cascades and resolve)',
        depth: 'SceneCloudDepth.render',
        frame: 'Engine.renderFrame (whole GPU interval)'
      },
      limits: [
        'Separate stage and frame intervals are not additive; GPU query overhead is included.',
        'Stationary daytime Earth views, fixed render time; no motion or image-parity validation.',
        'Warm timings exclude boot, compilation, screenshots and artifact writes.',
        'Compare matching GPU, browser, viewport, renderer pixel ratio, pose, assets and settings; dirty source requires recording the diff.',
        'No automatic speedup conclusion or universal hardware performance threshold.'
      ]
    },
    cases: [],
    intervals: []
  }
  let server
  const progress = (phase, extra = {}) => console.log(JSON.stringify({ phase, at: new Date().toISOString(), ...extra }))
  try {
    await save('progress', report)
    const { createServer } = await import('vite')
    server = await createServer({
      root,
      clearScreen: false,
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: true,
        hmr: false,
        watch: null,
        open: false
      }
    })
    // Vite 7's server.listen() normalizes port 0 to its default. Its wrapped
    // HTTP listener still initializes Vite and lets the OS select a free port.
    await new Promise((resolve, reject) => {
      server.httpServer.once('error', reject)
      server.httpServer.listen(0, '127.0.0.1', () => {
        server.httpServer.off('error', reject)
        resolve()
      })
    })
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Benchmark server did not obtain a local port')
    const origin = `http://127.0.0.1:${address.port}`
    progress('start', { outputDir, options })
    await withCloudProbeBrowser(
      { url: `${origin}/tests/clouds/scene/probe.html`, outputDir, width: options.width, height: options.height },
      async ({ evaluate, send, screenshot, webglErrors }) => {
        const invoke = (method, args = [], timeout = 200000) =>
          evaluate(
            `import('/tests/clouds/scene/benchmark.gpu.ts').then(m => m[${JSON.stringify(method)}](...${JSON.stringify(args)}))`,
            timeout
          )
        const waitFor = async (expression, label) => {
          const deadline = Date.now() + 180000
          progress(label)
          while (!(await evaluate(expression))) {
            if (Date.now() > deadline) throw new Error(`${label} deadline`)
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
        }
        try {
          await send('Page.navigate', { url: `${origin}/` })
          await waitFor(`!!document.querySelector('[aria-label="Run Solar system"]')`, 'production-menu')
          await evaluate(`document.querySelector('[aria-label="Run Solar system"]').click()`)
          await waitFor(
            `import('/src/ui/mobx/EngineStore.ts').then(({engineStore:s}) => !!s.app?.engine?.initialized && !s.appLoadingStatus)`,
            'production-solar-boot'
          )
          report.environment = await invoke('prepare', [options.qualities[0]])
          progress('environment', report.environment)
          for (const quality of options.qualities)
            for (const view of options.views) {
              const id = `${quality}-${view}`
              progress('settling', { id })
              const state = await invoke('setCase', [quality, view])
              if (
                state.state.drawingBuffer[0] !== options.width ||
                state.state.drawingBuffer[1] !== options.height ||
                state.state.rendererPixelRatio !== 1 ||
                report.environment.dpr !== 1
              )
                throw new Error('Renderer resolution differs from requested DPR-1 viewport')
              report.cases.push({ id, ...state })
              await screenshot(id)
              await save('progress', report)
              for (let repeat = 1; repeat <= options.repeats; repeat++)
                for (const stage of options.stages) {
                  progress('measuring', { id, repeat, stage, samples: options.samples })
                  const interval = await invoke('measure', [stage, options.samples], 200000 + options.samples * 100)
                  report.intervals.push({ id, repeat, ...interval })
                  await save('progress', report)
                  progress('measured', { id, repeat, stage, ...interval.gpu })
                }
            }
        } finally {
          report.webglErrors = webglErrors
          await invoke('dispose').catch(() => {})
        }
      }
    )
    const expected = options.qualities.length * options.views.length * options.stages.length * options.repeats
    if (report.intervals.length !== expected)
      throw new Error(`Incomplete benchmark: ${report.intervals.length}/${expected}`)
    report.status = 'complete'
    report.completedAt = new Date().toISOString()
    await save('report', report)
    await save('progress', report)
    console.table(
      report.intervals.map(({ id, repeat, stage, gpu }) => ({
        case: id,
        repeat,
        stage,
        count: gpu.count,
        meanMs: gpu.mean.toFixed(3),
        p50Ms: gpu.p50.toFixed(3),
        p95Ms: gpu.p95.toFixed(3)
      }))
    )
    console.log(`Cloud GPU benchmark complete: ${resolve(outputDir, 'report.json')}`)
  } catch (error) {
    report.status = 'failed'
    report.error = String(error)
    await save('failure', report)
    await save('progress', report)
    throw error
  } finally {
    await server?.close()
  }
}
