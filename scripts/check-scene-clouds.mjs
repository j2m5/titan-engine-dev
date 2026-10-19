import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withCloudProbeBrowser, runCloudProbeEvaluation } from './lib/cloud-probe-browser.mjs'

const args = process.argv.slice(2)
if (
  args.length > 1 ||
  args.some(
    (arg) => !/^--probe=(maps|depth|lighting|readiness|receivers|pipeline|scheduling|lifecycle|flight|all)$/.test(arg)
  )
)
  throw new Error(
    'Supported probes: maps, depth, lighting, readiness, receivers, pipeline, scheduling, lifecycle, flight, all'
  )
const probe = args[0]?.split('=')[1] ?? 'all'
const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '../tmpscreenshots/scene-clouds')
await mkdir(outputDir, { recursive: true })
const pageUrl = process.env.SCENE_CLOUD_PROBE_URL ?? 'http://127.0.0.1:8086/tests/clouds/scene/probe.html'
const expectedShaderFailureWindows = []
const report = await withCloudProbeBrowser(
  {
    url: pageUrl,
    outputDir,
    expectedError: (error) =>
      typeof error?.timestamp === 'number' &&
      expectedShaderFailureWindows.some(({ start, end }) => error.timestamp >= start && error.timestamp <= end) &&
      /INVALID_OPERATION.*(?:program|shader)/i.test(error.text ?? '')
  },
  async ({ evaluate, webglErrors, send, screenshot, requests }) => {
    const names =
      probe === 'all'
        ? await evaluate("import('/tests/clouds/scene/probe.ts').then(m => Object.keys(m.sceneCloudProbeRegistry))")
        : [probe]
    if (!names.length) throw new Error('No scene cloud probes registered')
    const probes = {}
    // Fixture probes run before flight navigates away from their page.
    names.sort((a, b) => Number(a === 'flight') - Number(b === 'flight'))
    for (const name of names) {
      try {
        let requiredCases = await evaluate(
          `import('/tests/clouds/scene/probe.ts').then(m => m.sceneCloudProbeRegistry[${JSON.stringify(name)}]?.requiredCases)`
        )
        if (!requiredCases?.length) throw new Error(`Unregistered probe: ${name}`)
        if (name === 'flight') {
          const scope = await evaluate(
            `import('/tests/clouds/scene/probe.ts').then(m => m.getSceneCloudFlightScope(${JSON.stringify(process.env.SCENE_CLOUD_FLIGHT_START)}))`
          )
          requiredCases = scope.requiredCases
          const baselineDir = process.env.SCENE_CLOUD_BASELINE_DIR
          if (!baselineDir) throw new Error('Set SCENE_CLOUD_BASELINE_DIR to the saved main-scene baseline directory')
          const terrain = JSON.parse(await readFile(resolve(baselineDir, 'terrain-evidence.json'), 'utf8'))
          const loaded = JSON.parse(await readFile(resolve(baselineDir, 'loaded-evidence.json'), 'utf8'))
          const { p50, p95, gpu, userAgent, viewport, dpr, rendererPixelRatio, memory, programs } = terrain.sample
          const baseline = {
            terrain: {
              pose: terrain.pose,
              sample: { p50, p95, gpu, userAgent, viewport, dpr, rendererPixelRatio, memory, programs }
            },
            loaded: { phases: loaded.phases.map(({ pose }) => ({ pose })) }
          }
          await send('Page.navigate', { url: new URL('/', pageUrl).href })
          const waitFor = async (expression, label) => {
            const deadline = Date.now() + 180000
            let progressAt = Date.now()
            console.log(JSON.stringify({ phase: label, at: new Date().toISOString() }))
            while (!(await evaluate(expression))) {
              if (Date.now() > deadline) throw new Error(`${label} deadline`)
              if (Date.now() - progressAt >= 15000) {
                console.log(JSON.stringify({ phase: label, waitingMs: 180000 - (deadline - Date.now()) }))
                progressAt = Date.now()
              }
              await new Promise((resolve) => setTimeout(resolve, 250))
            }
          }
          await waitFor(`!!document.querySelector('[aria-label="Run Solar system"]')`, 'Production menu')
          await screenshot('flight-production-menu')
          await evaluate(`document.querySelector('[aria-label="Run Solar system"]').click()`)
          await waitFor(
            `import('/src/ui/mobx/EngineStore.ts').then(({engineStore:s}) => !!s.app?.engine?.initialized && !s.appLoadingStatus)`,
            'Production Solar boot'
          )
          await evaluate(`window.__sceneCloudFlightBaseline = ${JSON.stringify(baseline)}`)
          if (scope.start === 'peak') await evaluate(`window.__sceneCloudFlightStart = 'peak'`)
        }
        const timeout = name === 'flight' ? 1800000 : name === 'lifecycle' ? 600000 : 180000
        const invocation = runCloudProbeEvaluation(evaluate, name, requiredCases, `${name}-${Date.now()}`, timeout)
        // Attach rejection immediately while separately saving each functional frame checkpoint.
        let done = false,
          failure
        invocation.then(
          () => {
            done = true
          },
          (error) => {
            failure = error
            done = true
          }
        )
        const saved = new Set()
        let progressAt = Date.now()
        while (!done && name === 'flight') {
          const checkpoint = await evaluate(
            'window.__sceneCloudFlightCheckpoint && ({id: window.__sceneCloudFlightCheckpoint.id, data: window.__sceneCloudFlightCheckpoint.data})'
          )
          if (checkpoint && !saved.has(checkpoint.id)) {
            const artifact = `flight-${checkpoint.id}`
            await screenshot(artifact)
            await writeFile(resolve(outputDir, `${artifact}.json`), JSON.stringify(checkpoint.data, null, 2))
            await writeFile(
              resolve(outputDir, 'flight-progress.json'),
              JSON.stringify(await evaluate('window.__sceneCloudFlightEvidence'), null, 2)
            )
            saved.add(checkpoint.id)
            await evaluate(
              `window.__sceneCloudFlightCheckpoint?.id === ${JSON.stringify(checkpoint.id)} && window.__sceneCloudFlightCheckpoint.acknowledge()`
            )
          }
          if (Date.now() - progressAt > 15000) {
            const progress = await evaluate(
              'window.__sceneCloudFlightEvidence?.currentReadiness && window.__sceneCloudFlightEvidence'
            )
            if (progress) await writeFile(resolve(outputDir, 'flight-progress.json'), JSON.stringify(progress, null, 2))
            progressAt = Date.now()
          }
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (failure) throw failure
        probes[name] = await invocation
        await writeFile(resolve(outputDir, `${name}-report.json`), JSON.stringify(probes[name], null, 2))
        console.log(
          JSON.stringify({ completedProbe: name, checks: probes[name].checks, cases: probes[name].cases.length })
        )
        if (name === 'flight')
          await writeFile(
            resolve(outputDir, 'flight-evidence.json'),
            JSON.stringify(
              { evidence: await evaluate('window.__sceneCloudFlightEvidence'), requests, webglErrors },
              null,
              2
            )
          )
      } catch (error) {
        if (name === 'flight')
          await writeFile(
            resolve(outputDir, 'flight-progress.json'),
            JSON.stringify(await evaluate('window.__sceneCloudFlightEvidence').catch(() => null), null, 2)
          )
        await writeFile(
          resolve(outputDir, `${name}-failure-report.json`),
          JSON.stringify({ error: String(error), webglErrors }, null, 2)
        )
        throw error
      }
      expectedShaderFailureWindows.push(...(probes[name].expectedShaderFailureWindows ?? []))
    }
    return { probes, webglErrors }
  }
)
await writeFile(resolve(outputDir, `${probe}-report.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
