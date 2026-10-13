import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sharp = require('sharp')

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(base, 'tmpscreenshots/cloud-lab')
const profilePrefix = resolve(tmpdir(), 'titan-cloud-lab-')
const profile = await mkdtemp(profilePrefix)
const url = process.env.CLOUD_LAB_URL ?? 'http://127.0.0.1:8086/cloud-lab.html'
const chromePath =
  process.env.CHROME_BIN ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].find(existsSync)
if (!chromePath) throw new Error('Set CHROME_BIN to a Chromium executable')
await mkdir(output, { recursive: true })
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1280,800',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    'about:blank'
  ],
  { windowsHide: true, stdio: 'ignore' }
)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
let closeBrowser
let startupError
chrome.on('error', (error) => {
  startupError = error
})
try {
  let targets
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError
    try {
      const port = Number((await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      break
    } catch {
      await sleep(100)
    }
  }
  if (!targets) throw new Error('Chrome debugging endpoint did not start')
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let id = 0
  const pending = new Map()
  const errors = []
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id) {
      const promise = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) promise.reject(new Error(JSON.stringify(msg.error)))
      else promise.resolve(msg.result)
    } else if (msg.method === 'Log.entryAdded' && /WebGL|GL_INVALID|GL_/i.test(msg.params.entry.text)) {
      if (errors.length < 20) errors.push(msg.params.entry)
    } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails)
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
      errors.push(msg.params.args.map((arg) => arg.value ?? arg.description))
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id
      pending.set(next, { resolve, reject })
      socket.send(JSON.stringify({ id: next, method, params }))
    })
  closeBrowser = () => send('Browser.close')
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 180000
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  let state
  for (let i = 0; i < 180; i++) {
    await sleep(1000)
    state = await evaluate(
      `({state: document.querySelector('#cloud-lab')?.dataset.state, status: document.querySelector('.cloud-status')?.textContent, frames: document.querySelector('#cloud-lab')?.dataset.frames})`
    )
    if (state?.state === 'ready' || state?.state === 'error' || errors.length) break
  }
  console.log('Startup', JSON.stringify(state), 'errors', JSON.stringify(errors).slice(0, 12000))
  const screenshot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(resolve(output, `${name}.png`), Buffer.from(result.data, 'base64'))
  }
  if (state?.state !== 'ready' || errors.length) {
    await screenshot('startup-error')
    throw new Error('Cloud scene failed to start')
  }
  const settle = () =>
    evaluate(
      `new Promise((resolve, reject) => { const start = Number(document.querySelector('#cloud-lab').dataset.frames); const began = performance.now(); const poll = () => { if (Number(document.querySelector('#cloud-lab').dataset.frames) >= start + 24) resolve(true); else if (performance.now() - began > 90000) reject(new Error('Render frames stalled')); else requestAnimationFrame(poll); }; poll(); })`
    )
  const measurements = []
  const detailState = () =>
    evaluate(
      `({opacity:Number(document.querySelector('#cloud-lab').dataset.cloudOpacity), frames:Number(document.querySelector('#cloud-lab').dataset.cloudFrames)})`
    )
  for (const view of ['orbit', 'approach', 'above', 'inside', 'below']) {
    await evaluate(`document.querySelector('[data-view="${view}"]').click()`)
    await settle()
    await screenshot(view)
    measurements.push(
      await evaluate(
        `({view:'${view}',altitude:document.querySelector('#altitude').textContent,frame:document.querySelector('#frame-time').textContent})`
      )
    )
    console.log('Rendered', view)
    if (view === 'orbit') {
      const before = await detailState()
      await evaluate(`document.querySelector('#clouds-enabled').click()`)
      await settle()
      const after = await detailState()
      if (before.opacity !== 0 || before.frames !== 0 || after.frames !== before.frames)
        throw new Error('Distant clouds must have no opacity and perform no rendering')
      await screenshot('orbit-without-clouds')
      await evaluate(`document.querySelector('#clouds-enabled').click()`)
    }
    if (view === 'approach' && Math.abs((await detailState()).opacity - 0.5) > 0.001)
      throw new Error('Cloud detail did not reach the middle of the distance transition')
    if (view === 'above' && (await detailState()).opacity !== 1)
      throw new Error('Near cloud detail did not reach full opacity')
  }
  await evaluate(`document.querySelector('[data-view="orbit"]').click()`)
  await settle()
  const stoppedClouds = await detailState()
  await settle()
  if (stoppedClouds.opacity !== 0 || (await detailState()).frames !== stoppedClouds.frames)
    throw new Error('Cloud and shadow rendering did not stop after leaving the detail range')
  await evaluate(
    `document.querySelector('[data-view="above"]').click(); document.querySelector('#clouds-enabled').click()`
  )
  await settle()
  await screenshot('above-without-clouds')
  const comparisons = []
  for (const view of ['orbit', 'above']) {
    const [on, off] = await Promise.all(
      [view, `${view}-without-clouds`].map(async (name) => {
        return sharp(resolve(output, `${name}.png`))
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
      })
    )
    let changed = 0
    for (let y = 0; y < on.info.height; y++)
      for (let x = 350; x < on.info.width; x++) {
        const i = (y * on.info.width + x) * 3
        const difference =
          Math.abs(on.data[i] - off.data[i]) +
          Math.abs(on.data[i + 1] - off.data[i + 1]) +
          Math.abs(on.data[i + 2] - off.data[i + 2])
        if (difference > 12) changed++
      }
    comparisons.push({ view, changedPixels: changed })
  }
  console.log('Cloud visibility', JSON.stringify(comparisons))
  const orbitPixels = await sharp(resolve(output, 'orbit-without-clouds.png'))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const brightness = (x, y) => {
    const i = (y * orbitPixels.info.width + x) * 3
    return (orbitPixels.data[i] + orbitPixels.data[i + 1] + orbitPixels.data[i + 2]) / 3
  }
  const surfaceContrast = Math.abs(brightness(900, 400) - brightness(400, 400))
  await evaluate(
    `document.querySelector('#clouds-enabled').click(); const quality = document.querySelector('#cloud-quality'); quality.value = 'low'; quality.dispatchEvent(new Event('change')); const sun = document.querySelector('#sun-angle'); sun.value = '89'; sun.dispatchEvent(new Event('input'))`
  )
  await settle()
  await screenshot('sunset-low')
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false })
  await settle()
  await screenshot('resized')
  const gpu = await evaluate(
    `(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return {renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), glError: gl.getError(), state: document.querySelector('#cloud-lab').dataset.state}; })()`
  )
  const depth = await evaluate(`import('/tests/clouds/planetDepth.gpu.ts').then(m => {
    let baselineError = null;
    try { m.checkPlanetDepth(false) } catch (error) { baselineError = error.message }
    return {baselineError, checks: m.checkPlanetDepth()};
  })`)
  const occlusion = await evaluate(`import('/tests/clouds/cloudOcclusion.gpu.ts').then(m => m.checkCloudOcclusion())`)
  const disposed = await evaluate(
    `(() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); return document.querySelectorAll('.cloud-viewport canvas').length === 0; })()`
  )
  const report = { measurements, comparisons, surfaceContrast, depth, occlusion, stoppedClouds, disposed, gpu, errors }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (errors.length || gpu.glError) throw new Error('Shader/runtime errors in cloud lab')
  if (comparisons.find((result) => result.view === 'orbit').changedPixels > 50)
    throw new Error('Distant clouds changed the textured planet appearance')
  if (comparisons.find((result) => result.view === 'above').changedPixels < 5000)
    throw new Error('Nearby clouds are missing')
  if (surfaceContrast < 12) throw new Error('Orbital surface depth/lighting is flattened')
  if (!depth.baselineError) throw new Error('Upstream depth behavior changed: review whether the adapter is needed')
  if (!disposed) throw new Error('Leaving the laboratory did not release its canvas')
} finally {
  if (closeBrowser) await Promise.race([closeBrowser().catch(() => {}), sleep(1000)])
  socket?.close()
  chrome.kill()
  // Only delete the temporary profile created by this invocation, never a user browser profile.
  if (resolve(profile).startsWith(profilePrefix) && profile !== profilePrefix) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}
