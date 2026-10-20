import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scenarios } from '@/config/scenarios'
import type { Application } from '@/Application'
import type { SimulationRuntime } from '@/ui/runtime/simulationRuntime'

const loader = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/ui/runtime/runtimeLoader', () => ({ loadSimulationRuntimeModule: loader.load }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe('deferred simulation selection', () => {
  it('imports only on selection and shares initialization for A → B', async () => {
    const { engineStore } = await import('@/ui/mobx/EngineStore')
    const pending = deferred<{ initializeSimulationRuntime: () => Promise<SimulationRuntime> }>()
    const app = { run: vi.fn(async () => {}), dispose: vi.fn() } as unknown as Application
    const runtime = { app, SimulationUI: () => null } as unknown as SimulationRuntime
    const initialize = vi.fn(async () => runtime)
    loader.load.mockReturnValue(pending.promise)
    expect(loader.load).not.toHaveBeenCalled()
    const a = engineStore.setScenario(Scenarios[0])
    const b = engineStore.setScenario(Scenarios[1])
    pending.resolve({ initializeSimulationRuntime: initialize })
    await Promise.all([a, b])
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(app.run).toHaveBeenCalledTimes(1)
    expect(app.run).toHaveBeenCalledWith(Scenarios[1])
    await engineStore.setScenario(null)
    await engineStore.setScenario(Scenarios[0])
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(app.run).toHaveBeenCalledTimes(2)
    expect(engineStore.runtime).toBe(runtime)
  })

  it('does not initialize when cancelled while importing', async () => {
    const { engineStore } = await import('@/ui/mobx/EngineStore')
    const pending = deferred<{ initializeSimulationRuntime: () => Promise<SimulationRuntime> }>()
    const initialize = vi.fn()
    loader.load.mockReturnValue(pending.promise)
    const selection = engineStore.setScenario(Scenarios[0])
    await engineStore.setScenario(null)
    pending.resolve({ initializeSimulationRuntime: initialize })
    await selection
    expect(initialize).not.toHaveBeenCalled()
    expect(engineStore.scenario).toBeNull()
    expect(engineStore.appLoadingStatus).toBe(false)
  })

  it('does not run a stale selection after initialization completes', async () => {
    const { engineStore } = await import('@/ui/mobx/EngineStore')
    const pending = deferred<SimulationRuntime>()
    const app = { run: vi.fn(), dispose: vi.fn() } as unknown as Application
    loader.load.mockResolvedValue({ initializeSimulationRuntime: () => pending.promise })
    const selection = engineStore.setScenario(Scenarios[0])
    await Promise.resolve()
    await engineStore.setScenario(null)
    pending.resolve({ app } as SimulationRuntime)
    await selection
    expect(app.run).not.toHaveBeenCalled()
    expect(engineStore.scenario).toBeNull()
  })

  it('returns to the menu on import failure and allows another selection to retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { engineStore } = await import('@/ui/mobx/EngineStore')
    const app = { run: vi.fn(async () => {}), dispose: vi.fn() } as unknown as Application
    loader.load.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ initializeSimulationRuntime: async () => ({ app }) })
    await engineStore.setScenario(Scenarios[0])
    expect(engineStore.scenario).toBeNull()
    expect(engineStore.appLoadingStatus).toBe(false)
    await engineStore.setScenario(Scenarios[1])
    expect(app.run).toHaveBeenCalledWith(Scenarios[1])
  })

  it('does not report an obsolete import failure over the newer selection', async () => {
    const { engineStore } = await import('@/ui/mobx/EngineStore')
    const { notificationStore } = await import('@/ui/mobx/NotificationStore')
    const a = deferred<{ initializeSimulationRuntime: () => Promise<SimulationRuntime> }>()
    const b = deferred<{ initializeSimulationRuntime: () => Promise<SimulationRuntime> }>()
    loader.load.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const first = engineStore.setScenario(Scenarios[0])
    const second = engineStore.setScenario(Scenarios[1])
    a.reject(new Error('obsolete transfer'))
    await first
    expect(engineStore.scenario?.id).toBe(Scenarios[1].id)
    expect(engineStore.appLoadingStatus).toBe(true)
    expect(notificationStore.notifications).toHaveLength(0)
    const app = { run: vi.fn(async () => {}), dispose: vi.fn() } as unknown as Application
    b.resolve({ initializeSimulationRuntime: async () => ({ app }) as SimulationRuntime })
    await second
    expect(engineStore.scenario?.id).toBe(Scenarios[1].id)
    expect(engineStore.appLoadingStatus).toBe(false)
  })
})
