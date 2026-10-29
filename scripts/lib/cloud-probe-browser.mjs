import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'

export function observeBrowserExit(child, close) {
  let failure
  child.once('exit', (code, signal) => {
    if (code !== 0) failure = new Error(`Browser exited: code ${code}, signal ${signal}`)
    close()
  })
  return {
    check() {
      if (failure) throw failure
    }
  }
}

export function assertNoUnexpectedCloudErrors(errors, expectedError = () => false) {
  const unexpected = errors.filter((error) => !expectedError(error))
  if (unexpected.length) throw new Error(`Probe runtime/WebGL errors: ${JSON.stringify(unexpected)}`)
}

export async function runCloudProbeEvaluation(evaluate, name, requiredCases, runId, timeoutMs = 180000) {
  const completion = await evaluate(
    `(async () => {
    let rafFrames = 0, active = true, raf;
    const tick = () => { if (active) { rafFrames++; raf = requestAnimationFrame(tick); } };
    raf = requestAnimationFrame(tick);
    try {
      const module = await import('/tests/clouds/scene/probe.ts');
      const report = await module.runSceneCloudProbe(${JSON.stringify(name)});
      await new Promise(requestAnimationFrame);
      return { runId: ${JSON.stringify(runId)}, rafFrames, report };
    } finally { active = false; cancelAnimationFrame(raf); }
  })()`,
    timeoutMs
  )
  if (completion?.runId !== runId) throw new Error(`Stale probe report: ${name}`)
  if (!(completion.rafFrames > 0)) throw new Error(`No RAF progression: ${name}`)
  const report = completion.report
  if (
    !report ||
    report.name !== name ||
    !Array.isArray(report.cases) ||
    requiredCases.some((id) => !report.cases.includes(id)) ||
    !Number.isInteger(report.checks) ||
    report.checks < requiredCases.length ||
    !Number.isFinite(report.maxError) ||
    report.maxError < 0 ||
    report.resourcesReleased !== true
  )
    throw new Error(`Incomplete scene cloud probe ${name}: ${JSON.stringify(completion)}`)
  return report
}

export function createCdpTransport(socket, onEvent, timeoutMs = 190000) {
  let id = 0
  let closed = false
  const pending = new Map()
  const close = () => {
    closed = true
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('CDP transport closed'))
    }
    pending.clear()
  }
  socket.onclose = close
  socket.onerror = close
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (!msg.id) {
      onEvent(msg)
      return
    }
    const request = pending.get(msg.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(msg.id)
    if (msg.error) request.reject(new Error(JSON.stringify(msg.error)))
    else request.resolve(msg.result)
  }
  return (method, params = {}, requestTimeoutMs = timeoutMs) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('CDP transport closed'))
        return
      }
      const next = ++id
      const timer = setTimeout(() => {
        pending.delete(next)
        reject(new Error(`CDP timeout: ${method}`))
      }, requestTimeoutMs)
      pending.set(next, { resolve, reject, timer })
      try {
        socket.send(JSON.stringify({ id: next, method, params }))
      } catch (error) {
        clearTimeout(timer)
        pending.delete(next)
        reject(error)
      }
    })
}

export async function withCloudProbeBrowser(
  { url, outputDir, width = 1280, height = 800, offline = false, expectedError = () => false },
  run
) {
  const parsed = new URL(url)
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
    parsed.protocol !== 'http:' ||
    ![
      '/tests/clouds/earth/probe.html',
      '/tests/clouds/scene/probe.html',
      '/earth-cloud-lab.html',
      '/cloud-lab.html'
    ].includes(parsed.pathname)
  )
    throw new Error('Cloud probe requires local probe.html')
  const profilePrefix = resolve(tmpdir(), 'earth-cloud-probe-')
  const webglErrors = []
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
  await mkdir(outputDir, { recursive: true })
  const profile = await mkdtemp(profilePrefix)
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
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
  const exitState = observeBrowserExit(chrome, () => socket?.close())
  chrome.on('error', (error) => {
    startupError = error
  })
  try {
    let targets
    for (let i = 0; i < 100; i++) {
      exitState.check()
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
    const errors = webglErrors
    const requests = []
    const send = createCdpTransport(socket, (msg) => {
      if (msg.method === 'Fetch.requestPaused') {
        const local = new URL(msg.params.request.url).origin === parsed.origin
        send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
          requestId: msg.params.requestId,
          ...(local ? {} : { errorReason: 'BlockedByClient' })
        }).catch((error) => errors.push({ message: error.message }))
      } else if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url)
      else if (msg.method === 'Log.entryAdded' && /WebGL|GL_INVALID|GL_/i.test(msg.params.entry.text)) {
        if (errors.length < 20) errors.push(msg.params.entry)
      } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails)
      else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
        errors.push(msg.params.args.map((arg) => arg.value ?? arg.description))
      else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.args[0]?.value === 'SCENE_CLOUD_LIFECYCLE_PHASE')
        console.log(msg.params.args[1]?.value)
      else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.args[0]?.value === 'SCENE_CLOUD_FLIGHT_PHASE')
        console.log(msg.params.args[1]?.value)
    })
    closeBrowser = () => send('Browser.close')
    const evaluate = async (expression, timeoutMs = 180000) => {
      const result = await send(
        'Runtime.evaluate',
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout: timeoutMs
        },
        timeoutMs + 10000
      )
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Log.enable')
    await send('Network.enable')
    if (offline)
      await send('Fetch.enable', {
        patterns: [
          { urlPattern: 'http://*', requestStage: 'Request' },
          { urlPattern: 'https://*', requestStage: 'Request' }
        ]
      })
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url })
    for (let i = 0; i < 100; i++) {
      if (
        await evaluate(
          "document.body?.dataset.ready === 'true' || document.querySelector('#earth-cloud-lab')?.dataset.state === 'ready' || document.querySelector('#cloud-lab')?.dataset.state === 'ready'"
        )
      )
        break
      if (i === 99) throw new Error('Probe page did not become ready')
      await sleep(100)
    }
    const screenshot = async (name) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid screenshot name')
      const result = await send('Page.captureScreenshot', { format: 'png' })
      await writeFile(resolve(outputDir, `${name}.png`), Buffer.from(result.data, 'base64'))
    }
    const result = await run({ evaluate, screenshot, webglErrors, requests, send })
    exitState.check()
    assertNoUnexpectedCloudErrors(webglErrors, expectedError)
    return result
  } finally {
    if (closeBrowser) await Promise.race([closeBrowser().catch(() => {}), sleep(1000)])
    socket?.close()
    chrome.kill()
    const resolvedProfile = resolve(profile)
    if (
      dirname(resolvedProfile) === resolve(tmpdir()) &&
      resolvedProfile.startsWith(profilePrefix) &&
      resolvedProfile !== profilePrefix
    )
      await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}
