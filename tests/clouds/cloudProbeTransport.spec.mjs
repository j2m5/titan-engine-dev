import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createCdpTransport } from '../../scripts/lib/cloud-probe-browser.mjs'

test('CDP transport bounds unresponsive requests', async () => {
  const socket = { send() {} }
  const send = createCdpTransport(socket, () => {}, 20)
  await assert.rejects(send('Page.enable'), /CDP timeout: Page.enable/)
})
test('one long evaluation can use its own deadline while normal requests retain the default', async () => {
  const socket = {
    send(data) {
      const { id } = JSON.parse(data)
      setTimeout(() => socket.onmessage({ data: JSON.stringify({ id, result: { ok: true } }) }), 40)
    }
  }
  const send = createCdpTransport(socket, () => {}, 20)
  assert.deepEqual(await send('Runtime.evaluate', {}, 200), { ok: true })
  await assert.rejects(send('Page.enable'), /CDP timeout: Page.enable/)
})
for (const event of ['onclose', 'onerror'])
  test(`CDP ${event} rejects pending requests`, async () => {
    const socket = { send() {} }
    const send = createCdpTransport(socket, () => {}, 1000)
    const request = send('Runtime.evaluate')
    socket[event]()
    await assert.rejects(request, /CDP transport closed/)
  })
