import { test, runProbe } from './probe'
import { expect } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

test('native terrain worker cancellation', async ({ probePage }, testInfo) => {
  await runProbe(probePage, testInfo, '/tests/terrain/WorkerCancellation.browser.ts', 'checkWorkerCancellation')
})

test('native anime moving-target flight', async ({ probePage }, testInfo) => {
  await runProbe(probePage, testInfo, '/tests/transitions/MovingTargetFlight.browser.ts', 'checkMovingTargetFlight')
})

test('native texture fetch cancellation and cube orientation', async ({ probePage }, testInfo) => {
  let requests = 0
  let connectionClosed = false
  // A real local HTTP response stays open until browser fetch cancellation closes it.
  const server = createServer((_request, response) => {
    requests++
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Content-Type', 'image/png')
    response.writeHead(200)
    response.flushHeaders()
    response.on('close', () => { connectionClosed = true })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  const abortUrl = `http://127.0.0.1:${address.port}/held-texture.png`
  const headers = probePage.waitForResponse(response => response.url() === abortUrl)
  const aborted = probePage.waitForEvent('requestfailed', { predicate: request => request.url() === abortUrl })
  void headers.catch(() => {})
  void aborted.catch(() => {})
  try {
    const probe = runProbe(probePage, testInfo, '/tests/textures/TextureCancellation.browser.ts', 'checkTextureCancellationAndCube', [abortUrl])
    void probe.catch(() => {})
    expect((await headers).status(), 'Native fetch received the held HTTP response headers').toBe(200)
    await probePage.evaluate(() => window.dispatchEvent(new Event('titan-test-texture-response')))
    await probe
    const request = await aborted
    expect(request.failure()?.errorText, 'Actual browser request must be cancelled').toMatch(/ERR_ABORTED/)
    expect(requests, 'Texture fetch reached the real HTTP endpoint').toBe(1)
    await expect.poll(() => connectionClosed, { message: 'Cancelled fetch closed its HTTP connection' }).toBe(true)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
