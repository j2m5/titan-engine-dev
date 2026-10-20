import { test as base, expect, type Page, type TestInfo } from '@playwright/test'

type ConsoleEntry = { type: string; text: string; location: unknown }

/** Every probe gets Playwright's fresh page/context; diagnostics include failed imports and shader logs. */
export const test = base.extend<{ probePage: Page }>({
  probePage: async ({ page }, runTest, testInfo) => {
    const consoleEntries: ConsoleEntry[] = []
    const pageErrors: string[] = []
    const failedRequests: { url: string; failure: string | null }[] = []
    page.on('console', message => consoleEntries.push({
      type: message.type(), text: message.text(), location: message.location()
    }))
    page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
    page.on('requestfailed', request => failedRequests.push({
      url: request.url(), failure: request.failure()?.errorText ?? null
    }))
    try {
      await page.goto('/tests/browser/harness.html')
      const renderer = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl2')
        if (!gl) throw new Error('WebGL2 is required: browser probes cannot run without a real context')
        const debug = gl.getExtension('WEBGL_debug_renderer_info')
        return {
          version: gl.getParameter(gl.VERSION) as string,
          renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as string,
          vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR) as string,
          userAgent: navigator.userAgent
        }
      })
      await attachJson(testInfo, 'webgl-environment', renderer)
      await runTest(page)
    } finally {
      const expectedRestorationWarning = (entry: ConsoleEntry): boolean =>
        testInfo.title === 'bitmap context restoration' && entry.type === 'warning' &&
        /^WebGL: INVALID_OPERATION: (?:delete|deleteVertexArray): object does not belong to this context$/.test(entry.text)
      const warningClassifications = consoleEntries.filter(entry => entry.type === 'warning').map(entry => ({
        text: entry.text,
        category: expectedRestorationWarning(entry) ? 'expected-context-restoration-cleanup' :
          /GL Driver Message \(OpenGL, Performance,.*GPU stall due to ReadPixels/.test(entry.text) ? 'gpu-readback-performance' : 'warning'
      }))
      await attachJson(testInfo, 'browser-diagnostics', { console: consoleEntries, warningClassifications, pageErrors, failedRequests })
      expect(pageErrors, 'Unhandled browser exceptions').toEqual([])
      const errors = consoleEntries.filter(entry => entry.type === 'error' ||
        /THREE\.WebGLProgram: Shader Error|VALIDATE_STATUS.*false|Error compiling shader/i.test(entry.text) ||
        // Native ANGLE/D3D11 regression: the density sampler must compile without
        // an uninitialized-return warning, even when its pixels look correct.
        /\bX4000\b.*\b(?:f_)?nebulaMedium\b/i.test(entry.text) ||
        (entry.type === 'warning' && /WebGL: (?:INVALID_|OUT_OF_MEMORY|CONTEXT_LOST)/.test(entry.text) && !expectedRestorationWarning(entry)))
      expect(errors, 'Browser console/shader errors').toEqual([])
    }
  }
})

export async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}

export async function runProbe(page: Page, testInfo: TestInfo, path: string, name: string, args: unknown[] = []): Promise<unknown> {
  const outcome = await page.evaluate(async ({ path, name, args }) => {
    try {
      const module = await import(/* @vite-ignore */ path) as Record<string, (...args: unknown[]) => unknown>
      if (typeof module[name] !== 'function') throw new Error(`Missing browser probe export: ${path}#${name}`)
      return { status: 'passed' as const, result: await module[name](...args) }
    } catch (error) {
      return {
        status: 'failed' as const,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        measurements: error && typeof error === 'object' && 'results' in error ? error.results : undefined
      }
    }
  }, { path, name, args })
  await attachJson(testInfo, 'probe-result', { path, name, args, ...outcome })
  if (outcome.status === 'failed') throw new Error(outcome.error)
  const result = outcome.result
  expect(result, 'Self-asserting probe must return its measured results').toBeDefined()
  expect(result).not.toBeNull()
  return result
}
