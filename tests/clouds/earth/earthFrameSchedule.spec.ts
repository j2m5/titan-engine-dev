import { describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { runEarthFrame, type EarthFramePorts } from '@/labs/earth-clouds/earthFrameSchedule'

function fixture(failure?: 'update' | 'near' | 'far' | 'present', thrown: unknown = new Error('failure')) {
  const calls: string[] = []
  const overlay = { map: new Texture() }
  const invoke = (name: string) => {
    calls.push(name)
    if (name.split(':')[0] === failure) throw thrown
  }
  const ports: EarthFramePorts = {
    updateVolume() {
      invoke('update')
      return { overlay, shadow: null }
    },
    renderNear(frame) {
      expect(frame.overlay).toBe(overlay)
      invoke('near')
    },
    renderFar(showMap) {
      invoke(`far:${showMap}`)
    },
    clearVolume() {
      invoke('clear')
    },
    present(weight) {
      invoke(`present:${weight}`)
    }
  }
  return { ports, calls }
}

describe('Earth frame schedule', () => {
  it.each([
    [0, true, ['clear', 'far:true', 'present:0'], false, false, true],
    [0.5, true, ['update', 'near', 'far:true', 'present:0.5'], true, true, true],
    [1, true, ['update', 'near', 'present:1'], true, true, false],
    [0.5, false, ['clear', 'far:false', 'present:0'], false, false, true]
  ] as const)('orders weight %s enabled %s', (weight, enabled, calls, updated, near, far) => {
    const f = fixture()
    expect(runEarthFrame({ requestedWeight: weight, cloudsEnabled: enabled }, f.ports)).toEqual({
      effectiveWeight: enabled ? weight : 0,
      volumeUpdated: updated,
      nearRendered: near,
      farRendered: far,
      volumeError: null
    })
    expect(f.calls).toEqual(calls)
  })
  it.each(['update', 'near'] as const)('recovers %s failure before rendering far once', (failure) => {
    const f = fixture(failure)
    const result = runEarthFrame({ requestedWeight: 1, cloudsEnabled: true }, f.ports)
    expect(result.effectiveWeight).toBe(0)
    expect(result.nearRendered).toBe(false)
    expect(result.volumeUpdated).toBe(failure === 'near')
    expect(result.volumeError?.message).toBe('failure')
    expect(f.calls).toEqual(
      failure === 'near'
        ? ['update', 'near', 'clear', 'far:true', 'present:0']
        : ['update', 'clear', 'far:true', 'present:0']
    )
  })
  it('normalizes non-Error volume diagnostics', () => {
    const f = fixture('update', 'volume unavailable')
    expect(runEarthFrame({ requestedWeight: 0.5, cloudsEnabled: true }, f.ports).volumeError).toEqual(
      new Error('volume unavailable')
    )
  })
  it.each(['far', 'present'] as const)('propagates fatal %s failure', (failure) => {
    const error = new Error('fatal'),
      f = fixture(failure, error)
    expect(() => runEarthFrame({ requestedWeight: 0.5, cloudsEnabled: true }, f.ports)).toThrow(error)
    expect(f.calls).not.toContain('clear')
  })
  it.each([NaN, Infinity, -Infinity, -0.01, 1.01])('rejects invalid weight %s before any work', (weight) => {
    const f = fixture()
    expect(() => runEarthFrame({ requestedWeight: weight, cloudsEnabled: false }, f.ports)).toThrow(RangeError)
    expect(f.calls).toEqual([])
  })
})
