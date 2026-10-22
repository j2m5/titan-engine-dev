import { CubeTexture, Scene } from 'three'
import { Application } from '@/Application'
import { Scenarios } from '@/config/scenarios'
import type { Engine } from '@/core/Engine'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import { NebulaBakeQueue } from '@/core/renderables/Nebula/volume/NebulaBakeQueue'

function setup() {
  const queue = new NebulaBakeQueue({ maxStepsPerFrame: 1, maxCpuMs: Infinity })
  const jobs: object[] = [], steps: number[] = [], starts: { scene: number; pending: number; steps: number }[] = []
  let scene = -1
  const engine = {
    dispose: () => { for (const job of jobs) queue.cancel(job) },
    initialize: () => {
      const id = ++scene, job = {}
      jobs.push(job); steps[id] = 0
      queue.enqueue(job, () => ++steps[id] === 3)
    },
    start: () => starts.push({ scene, pending: queue.pendingCount, steps: steps[scene] })
  }
  const observer = { scenario: null, sceneBackground: new CubeTexture(), loadPrimaryTextures: async () => {} }
  const gate = { clearNodeCache: () => {}, recompute: () => {} }
  const app = new Application(engine as unknown as Engine, observer as unknown as ResourceObserver,
    new Scene(), { record: () => null } as never, gate as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, queue)
  return { app, queue, starts, steps }
}

const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

describe('initial nebula preparation during scene loading', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts the first rendered frame only after initial density is ready', async () => {
    const s = setup(), pending = s.app.run(Scenarios[12])
    await tick()
    expect(s.starts).toEqual([])
    expect(s.steps).toEqual([1])
    await vi.runAllTimersAsync()
    await pending
    expect(s.starts).toEqual([{ scene: 0, pending: 0, steps: 3 }])
    s.app.dispose()
  })

  it('cancels loading without starting a disposed scene', async () => {
    const s = setup(), pending = s.app.run(Scenarios[12])
    await tick()
    s.app.dispose()
    await vi.runAllTimersAsync()
    await pending
    expect(s.starts).toEqual([])
    expect(s.steps).toEqual([1])
    expect(s.queue.pendingCount).toBe(0)
  })

  it('starts only the replacement scenario after its own density finishes', async () => {
    const s = setup(), first = s.app.run(Scenarios[12])
    await tick()
    const second = s.app.run(Scenarios[11])
    await tick()
    expect(s.starts).toEqual([])
    await vi.runAllTimersAsync()
    await Promise.all([first, second])
    expect(s.steps).toEqual([1, 3])
    expect(s.starts).toEqual([{ scene: 1, pending: 0, steps: 3 }])
    s.app.dispose()
  })
})
