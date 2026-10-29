import { describe, expect, it } from 'vitest'
import { EarthCloudState } from '@/labs/earth-clouds/earthCloudState'
import { runEarthFrame, type EarthFramePorts } from '@/labs/earth-clouds/earthFrameSchedule'

const ports = (): EarthFramePorts => ({ updateVolume: () => ({ overlay: {} as never, shadow: null }), renderFar() {}, renderNear() {}, clearVolume() {}, present() {} })
describe('Earth cloud readiness', () => {
  it('requires a successful fresh near frame and resets after returning from far', () => {
    const state = new EarthCloudState()
    expect(state.snapshot()).toEqual({ volumeState: 'prepared', volumeMessage: null, resetPending: true })
    expect(state.begin(0, true)).toEqual({ requestedWeight: 0, cloudsEnabled: true, resetHistory: false })
    const request = state.begin(0.5, true)
    expect(request.resetHistory).toBe(true)
    state.complete(runEarthFrame(request, ports()))
    expect(state.snapshot()).toEqual({ volumeState: 'ready', volumeMessage: null, resetPending: false })
    expect(state.begin(0.5, true).resetHistory).toBe(false)
    state.begin(0, true)
    expect(state.begin(0.5, true).resetHistory).toBe(true)
  })
  it.each(['view', 'Sun', 'rotation', 'quality', 'resize', 'DPR', 'off-on'])('coalesces %s invalidation until a fresh render', () => {
    const state = new EarthCloudState()
    state.complete(runEarthFrame(state.begin(1, true), ports()))
    state.invalidate(); state.invalidate()
    expect(state.snapshot().volumeState).toBe('prepared')
    state.complete(runEarthFrame(state.begin(0, true), ports()))
    expect(state.snapshot().resetPending).toBe(true)
    state.complete(runEarthFrame(state.begin(1, true), ports()))
    expect(state.snapshot().volumeState).toBe('ready')
  })
  it('latches near failure while retaining the disabled far-map flag', () => {
    const state = new EarthCloudState(), p = ports()
    p.renderNear = () => { throw new Error('compile failed') }
    state.complete(runEarthFrame(state.begin(1, true), p))
    state.invalidate()
    expect(state.begin(1, true).requestedWeight).toBe(0)
    expect(state.begin(1, false).cloudsEnabled).toBe(false)
    expect(state.snapshot().volumeMessage).toContain('compile failed')
  })
  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid requested weight %s', weight => {
    expect(() => new EarthCloudState().begin(weight, false)).toThrow(RangeError)
  })
})
