import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Preview must use the same deployment base as the already-built entrypoint.
const builtHtml = readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8')
const scriptSource = builtHtml.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/)?.[1]
if (!scriptSource) throw new Error('Build dist/index.html before running browser tests')
const scriptPath = new URL(scriptSource, 'http://127.0.0.1:8092/').pathname
const assetsIndex = scriptPath.lastIndexOf('/assets/')
if (assetsIndex < 0) throw new Error(`Cannot infer production preview base from ${scriptPath}`)
const previewBase = `${scriptPath.slice(0, assetsIndex)}/`
if (!/^\/(?:[A-Za-z0-9_.-]+\/)*$/.test(previewBase)) {
  throw new Error(`Unsupported production preview base: ${previewBase}`)
}

const environment = {
  VITE_SHOW_STATS_PANEL: 'false',
  VITE_APP_NAME: 'Titan Engine (browser test)',
  VITE_FS_DRIVER: 'local',
  VITE_FILE_BUCKET: 'browser-test',
  VITE_S3_URL: 'https://s3.invalid',
  VITE_SKY_SOURCE: 'gaia'
}

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  use: {
    browserName: 'chromium',
    channel: process.env.TITAN_BROWSER_CHANNEL || undefined,
    baseURL: 'http://127.0.0.1:8091',
    headless: true,
    launchOptions: {
      args: process.env.TITAN_BROWSER_GPU === 'native'
        ? []
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 8091 --strictPort',
      url: 'http://127.0.0.1:8091/tests/browser/harness.html',
      env: environment,
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 8092 --strictPort --base ${previewBase}`,
      url: `http://127.0.0.1:8092${previewBase}`,
      env: environment,
      reuseExistingServer: false,
      timeout: 60_000
    }
  ]
})
