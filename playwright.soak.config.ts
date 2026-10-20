import { defineConfig } from '@playwright/test'

// This opt-in run needs the owner's real resource archive. CI uses playwright.config.ts instead.
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.soak.ts',
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  outputDir: 'benchmark-results/artifacts',
  reporter: [['list'], ['json', { outputFile: 'benchmark-results/results.json' }]],
  use: {
    browserName: 'chromium',
    // The full browser's new headless mode supports the native GPU. The default
    // headless-shell executable may silently select SwiftShader on Windows.
    channel: process.env.TITAN_BROWSER_CHANNEL || 'chromium',
    baseURL: 'http://127.0.0.1:8093',
    headless: true,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 8093 --strictPort',
    url: 'http://127.0.0.1:8093',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_SHOW_STATS_PANEL: 'false',
      VITE_APP_NAME: 'Titan Engine (scenario benchmark)',
      VITE_FS_DRIVER: 'local',
      VITE_FILE_BUCKET: 'textures',
      VITE_S3_URL: '',
      VITE_SKY_SOURCE: 'gaia'
    }
  }
})
