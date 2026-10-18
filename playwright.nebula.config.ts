import { defineConfig } from '@playwright/test'

/** Full headless browser, native ANGLE. Never inherit the correctness suite's SwiftShader flags. */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/nebula.bench.ts',
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  outputDir: 'benchmark-results/nebula/artifacts',
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    channel: process.env.TITAN_BROWSER_CHANNEL || 'chromium',
    headless: true,
    baseURL: 'http://127.0.0.1:8094',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 8094 --strictPort',
    url: 'http://127.0.0.1:8094/tests/browser/harness.html',
    reuseExistingServer: false,
    timeout: 60_000
  }
})
