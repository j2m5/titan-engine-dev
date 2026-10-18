import { test, expect, type CDPSession } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { attachJson } from './probe'

const probePath = '/tests/browser/scenarioSoak.browser.ts'
type Probe = typeof import('./scenarioSoak.browser')
type Resources = ReturnType<Probe['snapshot']>
type Row = {
  phase: 'warmup' | 'measured'
  round: number
  scenario: Awaited<ReturnType<Probe['selectScenario']>>
  frames: { count: number; p50: number; p95: number; p99: number; max: number; elapsedMs: number }
  active: Resources
  menu: Resources
  heapBytesAfterGC: number
  requests: number
}

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

test('repeated real scenarios, moving camera and teardown measurements', async ({ page }, testInfo) => {
  const options = { rounds: 0, dwellMs: 0, scenarioIds: [] as number[], mode: 'Vite development, real local assets, 1280x720 DPR1; actual GPU recorded in each row' }
  const errors: string[] = []
  const warnings: string[] = []
  const assetFailures: string[] = []
  let totalRequests = 0
  page.on('request', () => { totalRequests++ })
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`)
    if (message.type() === 'warning') warnings.push(message.text())
  })
  page.on('response', response => {
    if (response.status() >= 400) assetFailures.push(`${response.status()} ${response.url()}`)
  })
  page.on('requestfailed', request => {
    if (!/ERR_ABORTED/.test(request.failure()?.errorText ?? '')) {
      assetFailures.push(`${request.failure()?.errorText} ${request.url()}`)
    }
  })
  let cdp: CDPSession | undefined
  const rows: Row[] = []
  const startedAt = new Date().toISOString()
  let outcome = 'failed'
  let failure: string | null = null
  try {
    options.rounds = positiveInteger('TITAN_SOAK_ROUNDS', 6)
    options.dwellMs = positiveInteger('TITAN_SOAK_DWELL_MS', 10_000)
    options.scenarioIds = (process.env.TITAN_SOAK_SCENARIOS ?? '1,2,13').split(',').map(Number)
    const { rounds, dwellMs, scenarioIds } = options
    if (!scenarioIds.length || scenarioIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error('TITAN_SOAK_SCENARIOS must contain comma-separated positive scenario IDs')
    }
    expect(existsSync(resolve('public/images/textures')), 'Real owner-provided textures are required; see README').toBe(true)
    cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext
      const canvases = new WeakSet<HTMLCanvasElement>()
      let count = 0
      Object.defineProperty(window, '__soakWebGLContexts', { get: () => count })
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
        const context = Reflect.apply(getContext, this, [type, options]) as RenderingContext | null
        if (context && /^(webgl|webgl2)$/.test(type) && !canvases.has(this)) {
          canvases.add(this)
          count++
        }
        return context
      } as typeof getContext
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: /^Run / }).first()).toBeVisible()
    for (let round = 0; round <= rounds; round++) {
      for (const id of scenarioIds) {
        const requestsBefore = totalRequests
        console.log(`Starting round ${round}/${rounds}, scenario ${id}`)
        const selected = await page.evaluate(async ({ path, id }) => {
          const probe = await import(/* @vite-ignore */ path) as Probe
          return probe.selectScenario(id)
        }, { path: probePath, id })
        // Fail explicitly if a machine silently falls back to software rendering.
        const environment = await page.evaluate(async path => {
          const probe = await import(/* @vite-ignore */ path) as Probe
          return probe.snapshot()
        }, probePath)
        console.log(`Renderer: ${environment.renderer}`)
        expect(environment.renderer, 'Native GPU required for this benchmark; try TITAN_BROWSER_CHANNEL=chrome').not.toMatch(/SwiftShader|llvmpipe|software rasterizer/i)
        const measurement = await page.evaluate(async ({ path, dwellMs }) => {
          const probe = await import(/* @vite-ignore */ path) as Probe
          return probe.exerciseScenario(dwellMs)
        }, { path: probePath, dwellMs })
        const menu = await page.evaluate(async path => {
          const probe = await import(/* @vite-ignore */ path) as Probe
          return probe.returnToMenu()
        }, probePath)
        await cdp.send('HeapProfiler.collectGarbage')
        const metrics = await cdp.send('Performance.getMetrics')
        const heap = metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value
        if (heap === undefined) throw new Error('Chromium did not report JSHeapUsedSize')
        const sorted = measurement.intervals.slice().sort((a, b) => a - b)
        const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1]
        rows.push({
          phase: round === 0 ? 'warmup' : 'measured', round, scenario: selected,
          frames: { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted[sorted.length - 1], elapsedMs: measurement.elapsedMs },
          active: measurement.resources, menu, heapBytesAfterGC: heap,
          requests: totalRequests - requestsBefore
        })
        console.log(`round ${round}/${rounds}, ${selected.name}: p95 ${percentile(0.95).toFixed(1)}ms, menu textures ${menu.textures}, geometries ${menu.geometries}, heap ${(heap / 1048576).toFixed(1)}MiB`)
        expect(errors, 'Browser errors invalidate the measurement').toEqual([])
        expect(assetFailures, 'Missing assets invalidate the measurement').toEqual([])
        expect(measurement.resources.canvases, 'Exactly one active render canvas').toBe(1)
        expect(menu.canvases, 'Menu retains only the single session canvas').toBe(1)
        expect(menu.createdWebGLContexts, 'Scenario switches reuse the single WebGL context').toBe(1)
      }
    }
    outcome = 'completed'
  } catch (error) {
    failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    const measured = rows.filter(row => row.phase === 'measured')
    const trend = (values: number[]) => ({ first: values[0] ?? null, last: values.at(-1) ?? null, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null })
    const report = {
      startedAt, finishedAt: new Date().toISOString(), outcome, failure, options, totalRequests,
      notes: ['Warmup rows are excluded from summary.', 'Frame intervals include GPU and main-thread work; no hardware-independent FPS threshold.', 'Renderer counts are live objects, not VRAM bytes. JS heap is sampled after explicit GC.', 'Gaia and renderer session caches may remain between scenarios. Inspect per-scenario rows before inferring a leak.'],
      summary: {
        menuCanvases: trend(measured.map(row => row.menu.canvases)),
        createdWebGLContexts: trend(measured.map(row => row.menu.createdWebGLContexts)),
        menuGeometries: trend(measured.map(row => row.menu.geometries)),
        menuTextures: trend(measured.map(row => row.menu.textures)),
        menuPrograms: trend(measured.map(row => row.menu.programs)),
        heapBytesAfterGC: trend(measured.map(row => row.heapBytesAfterGC))
      },
      byScenario: options.scenarioIds.map(id => {
        const same = measured.filter(row => row.scenario.id === id)
        return {
          id, name: same[0]?.scenario.name ?? null, samples: same.length,
          menuGeometries: trend(same.map(row => row.menu.geometries)),
          menuTextures: trend(same.map(row => row.menu.textures)),
          menuPrograms: trend(same.map(row => row.menu.programs)),
          heapBytesAfterGC: trend(same.map(row => row.heapBytesAfterGC)),
          requests: trend(same.map(row => row.requests))
        }
      }),
      rows, errors, warnings, assetFailures
    }
    await mkdir('benchmark-results', { recursive: true })
    await writeFile('benchmark-results/scenario-soak.json', JSON.stringify(report, null, 2))
    await attachJson(testInfo, 'scenario-soak', report)
    await cdp?.detach()
  }
})
