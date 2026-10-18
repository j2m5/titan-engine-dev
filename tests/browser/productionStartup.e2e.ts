import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { attachJson } from './probe'

// Respect the actual build base, including GitHub Pages' /repository/ prefix.
const html = readFileSync('dist/index.html', 'utf8')
const entry = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1]
if (!entry) throw new Error('Build the production app before running browser tests')
const entryURL = new URL(entry, 'http://127.0.0.1:8092/')
const appURL = new URL(entryURL.pathname.slice(0, entryURL.pathname.lastIndexOf('/assets/') + 1), entryURL.origin).href

test('production home loads without the simulation and requests it only on Run', async ({ page }, testInfo) => {
  const errors: string[] = []
  const scripts: { url: string; bytes: number; gzipBytes: number }[] = []
  const pending: Promise<void>[] = []
  let collectScripts = true
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('response', response => {
    if (collectScripts && response.request().resourceType() === 'script') {
      pending.push(response.body().then(body => {
        scripts.push({ url: response.url(), bytes: body.length, gzipBytes: gzipSync(body).length })
      }))
    }
  })
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    let count = 0
    Object.defineProperty(window, '__testWebGLContexts', { get: () => count })
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      const context = Reflect.apply(getContext, this, [type, options]) as RenderingContext | null
      if (context && (type === 'webgl2' || type === 'webgl')) count++
      return context
    } as typeof getContext
  })
  const contextCount = () => page.evaluate(() => Reflect.get(window, '__testWebGLContexts') as number)
  const start = performance.now()
  try {
    await page.goto(appURL)
    await expect(page.getByRole('button', { name: 'Run Solar system', exact: true })).toBeVisible()
    const homeVisibleMs = performance.now() - start
    await page.waitForLoadState('networkidle')
    await Promise.all(pending)
    collectScripts = false
    const initial = scripts.slice()
    const decodedBytes = initial.reduce((sum, script) => sum + script.bytes, 0)
    await attachJson(testInfo, 'production-first-screen', {
      homeVisibleMs, decodedBytes,
      gzipBytes: initial.reduce((sum, script) => sum + script.gzipBytes, 0),
      scripts: initial, webglContexts: await contextCount(),
      note: 'gzipBytes recompresses fetched JS for comparison; preview may serve uncompressed responses.'
    })
    expect(await contextCount(), 'The home screen must not initialize WebGL').toBe(0)
    expect(initial.some(script => /simulationRuntime-/.test(script.url)), 'The runtime must remain deferred').toBe(false)
    expect(decodedBytes, 'Home-screen JavaScript budget (uncompressed)').toBeLessThan(600_000)

    // Hold texture downloads: this checks the real runtime boundary without requiring the external archive.
    await page.route('**/*', async route => {
      const url = route.request().url()
      if (/\/textures\/|\/images\/browser-test\//.test(url)) return
      await route.continue()
    })
    const runtimeRequest = page.waitForRequest(request => /simulationRuntime-.*\.js/.test(request.url()))
    await page.getByRole('button', { name: 'Run Solar system', exact: true }).click()
    await runtimeRequest
    await expect(page.locator('.loading-screen')).toBeVisible()
    await expect.poll(contextCount, { timeout: 30_000 }).toBeGreaterThan(0)
    expect(errors, 'Production startup browser errors').toEqual([])
  } finally {
    await attachJson(testInfo, 'production-browser-errors', errors)
    // Pending routed textures are deliberately abandoned with this fresh browser context.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})
