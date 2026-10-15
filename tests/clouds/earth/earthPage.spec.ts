import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  loads: [] as { resolve: (value: unknown) => void }[],
  labs: [] as { dispose: ReturnType<typeof vi.fn>; setView: ReturnType<typeof vi.fn> }[]
}))
vi.mock('@/labs/earth-clouds/earthAssets', () => ({
  loadEarthTextures: () => new Promise((resolve) => state.loads.push({ resolve }))
}))
vi.mock('@/labs/earth-clouds/EarthCloudLab', () => ({
  EarthCloudLab: class {
    canvas = document.createElement('canvas')
    dispose = vi.fn(() => this.canvas.remove())
    setView = vi.fn()
    constructor(container: HTMLElement) {
      container.append(this.canvas)
      state.labs.push(this)
    }
    getStats() {
      return {
        altitudeKm: 20000,
        frameMs: 16.7,
        frames: 1,
        volumeWeight: 0,
        cloudFrames: 0,
        shadowFrames: 0,
        farFrames: 1,
        nearFrames: 0,
        volumeState: 'prepared'
      }
    }
  }
}))
let frames: FrameRequestCallback[]
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
const start = () => {
  frames.shift()!(0)
  frames.shift()!(0)
}
const transition = (type: string, persisted: boolean) =>
  window.dispatchEvent(new PageTransitionEvent(type, { persisted }))
beforeEach(async () => {
  vi.resetModules()
  state.loads.length = 0
  state.labs.length = 0
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  document.body.innerHTML = '<main id="earth-cloud-lab"></main>'
  await import('@/labs/earth-clouds/main')
  start()
})
afterEach(() => {
  transition('pagehide', false)
  vi.unstubAllGlobals()
})
describe('Earth page lifecycle', () => {
  it('recreates a usable page after persisted departure, once per restore', async () => {
    state.loads[0].resolve({ dispose: vi.fn() })
    await flush()
    transition('pagehide', true)
    transition('pagehide', true)
    expect(state.labs[0].dispose).toHaveBeenCalledTimes(1)
    expect(document.querySelector('canvas')).toBeNull()
    transition('pageshow', true)
    transition('pageshow', true)
    expect(frames).toHaveLength(1)
    start()
    expect(state.loads).toHaveLength(2)
    state.loads[1].resolve({ dispose: vi.fn() })
    await flush()
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    const button = document.querySelector<HTMLButtonElement>('[data-view=above]')!
    expect(button.disabled).toBe(false)
    button.click()
    expect(state.labs[1].setView).toHaveBeenCalledWith('above')
    transition('pagehide', false)
    transition('pageshow', true)
    expect(state.labs[1].dispose).toHaveBeenCalledTimes(1)
    expect(document.querySelector('canvas')).toBeNull()
  })
  it('disposes a pending old load without publishing into the restored session', async () => {
    transition('pagehide', true)
    transition('pageshow', true)
    expect(frames).toHaveLength(1)
    start()
    const old = { dispose: vi.fn() }
    state.loads[0].resolve(old)
    await flush()
    expect(old.dispose).toHaveBeenCalledTimes(1)
    expect(state.labs).toHaveLength(0)
    expect(document.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
    state.loads[1].resolve({ dispose: vi.fn() })
    await flush()
    expect(state.labs).toHaveLength(1)
    expect(document.querySelector('canvas')).not.toBeNull()
  })
})
