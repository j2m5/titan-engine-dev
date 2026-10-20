import { afterEach, describe, expect, it, vi } from 'vitest'
import { engineStore } from '@/ui/mobx/EngineStore'
import { notificationStore } from '@/ui/mobx/NotificationStore'
import { Scenarios } from '@/config/scenarios'
import type { Application } from '@/Application'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(async () => {
  await engineStore.setScenario(null)
  await engineStore.initialize(null as unknown as Application)
  notificationStore.notifications = []
  vi.restoreAllMocks()
})

describe('scenario selection generations', () => {
  it('keeps B loading when the superseded A run finishes', async () => {
    const a = deferred()
    const b = deferred()
    const app = { run: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise), dispose: vi.fn() }
    await engineStore.initialize(app as unknown as Application)
    const first = engineStore.setScenario(Scenarios[0])
    const second = engineStore.setScenario(Scenarios[1])
    a.resolve()
    await first
    expect(engineStore.scenario?.id).toBe(Scenarios[1].id)
    expect(engineStore.appLoadingStatus).toBe(true)
    b.resolve()
    await second
    expect(engineStore.appLoadingStatus).toBe(false)
  })

  it('ignores a superseded run failure without disposing B or notifying', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = deferred()
    const b = deferred()
    const app = { run: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise), dispose: vi.fn() }
    await engineStore.initialize(app as unknown as Application)
    const first = engineStore.setScenario(Scenarios[0])
    const second = engineStore.setScenario(Scenarios[1])
    a.reject(new Error('obsolete'))
    await first
    expect(engineStore.scenario?.id).toBe(Scenarios[1].id)
    expect(notificationStore.notifications).toHaveLength(0)
    expect(app.dispose).not.toHaveBeenCalled()
    b.resolve()
    await second
  })

  it('clears the loading state when selection is cancelled', async () => {
    const run = deferred()
    const app = { run: vi.fn(() => run.promise), dispose: vi.fn() }
    await engineStore.initialize(app as unknown as Application)
    const first = engineStore.setScenario(Scenarios[0])
    await engineStore.setScenario(null)
    expect(engineStore.appLoadingStatus).toBe(false)
    run.resolve()
    await first
    expect(engineStore.scenario).toBeNull()
  })
})
