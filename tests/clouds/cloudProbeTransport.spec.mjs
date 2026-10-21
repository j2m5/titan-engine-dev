import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createCdpTransport,
  runCloudProbeEvaluation,
  observeBrowserExit,
  assertNoUnexpectedCloudErrors
} from '../../scripts/lib/cloud-probe-browser.mjs'
import { EventEmitter } from 'node:events'
import { getSceneCloudFlightScope } from './scene/probe'

test('flight scope defaults to full and only accepts the explicit peak closure', () => {
  const full = getSceneCloudFlightScope(undefined)
  assert.equal(full.start, 'full')
  assert(full.requiredCases.includes('earth-altitude-path'))
  const peak = getSceneCloudFlightScope('peak')
  assert.equal(peak.start, 'peak')
  assert(!peak.requiredCases.includes('earth-altitude-path'))
  for (const id of [
    'production-solar-boot',
    'original-peak-depth',
    'moving-limb-consecutive',
    'jupiter-altitude-path',
    'stable-scenario-exits'
  ])
    assert(peak.requiredCases.includes(id))
  for (const value of ['', 'full', 'jupiter', 'Peak'])
    assert.throws(() => getSceneCloudFlightScope(value), /SCENE_CLOUD_FLIGHT_START/)
})

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

const completion = () => ({
  runId: 'fresh',
  rafFrames: 2,
  report: { name: 'flight', checks: 1, maxError: 0, resourcesReleased: true, cases: ['real-app'] }
})
test('runner rejects unclassified WebGL errors and retains timestamped injection windows', () => {
  const warning = { timestamp: 123, text: 'INVALID_OPERATION useProgram' }
  assert.throws(() => assertNoUnexpectedCloudErrors([warning]), /WebGL/)
  assert.doesNotThrow(() => assertNoUnexpectedCloudErrors([warning], (e) => e.timestamp >= 120 && e.timestamp <= 125))
  assert.throws(
    () =>
      assertNoUnexpectedCloudErrors([{ ...warning, timestamp: 130 }], (e) => e.timestamp >= 120 && e.timestamp <= 125),
    /WebGL/
  )
})
test('runner preserves rejected module evaluation', async () => {
  await assert.rejects(
    runCloudProbeEvaluation(
      async () => {
        throw Error('import rejected')
      },
      'flight',
      ['real-app'],
      'fresh'
    ),
    /import rejected/
  )
})
for (const [label, mutate, error] of [
  [
    'missing case',
    (v) => {
      v.report.cases = []
    },
    /Incomplete/
  ],
  [
    'missing report',
    (v) => {
      delete v.report
    },
    /Incomplete/
  ],
  [
    'stale report',
    (v) => {
      v.runId = 'previous'
    },
    /Stale/
  ],
  [
    'no RAF progression',
    (v) => {
      v.rafFrames = 0
    },
    /RAF/
  ],
  [
    'nonfinite error',
    (v) => {
      v.report.maxError = Infinity
    },
    /Incomplete/
  ],
  [
    'unreleased resources',
    (v) => {
      v.report.resourcesReleased = false
    },
    /Incomplete/
  ]
])
  test(`runner rejects ${label}`, async () => {
    const value = completion()
    mutate(value)
    await assert.rejects(
      runCloudProbeEvaluation(async () => value, 'flight', ['real-app'], 'fresh'),
      error
    )
  })
test('runner accepts only the completed current invocation', async () => {
  assert.deepEqual(
    await runCloudProbeEvaluation(async () => completion(), 'flight', ['real-app'], 'fresh'),
    completion().report
  )
})
test('browser nonzero exit closes transport and is reported', () => {
  const child = new EventEmitter()
  let closed = false
  const state = observeBrowserExit(child, () => {
    closed = true
  })
  child.emit('exit', 7, null)
  assert.equal(closed, true)
  assert.throws(() => state.check(), /Browser exited.*7/)
})
