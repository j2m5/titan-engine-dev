import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CubeTexture, Scene } from 'three'
import { Application } from '@/Application'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Scenarios } from '@/config/scenarios'
import type { Engine } from '@/core/Engine'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import type { LeakDetector } from '@/core/lifecycle/LeakDetector'

const leakDetector = { record: () => null } as unknown as LeakDetector
const heightFieldGate = { recompute: vi.fn(), dispose: vi.fn() } as never

describe('Application.teardown', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('разбирает граф до освобождения текстур', () => {
    const order: string[] = []
    const engine = { dispose: vi.fn(() => order.push('engine')), start: vi.fn() } as unknown as Engine
    const observer = {} as unknown as ResourceObserver
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {
      order.push('textures')
    })

    new Application(engine, observer, new Scene(), leakDetector, heightFieldGate).teardown()

    expect(order).toEqual(['engine', 'textures'])
  })

  it('dispose() выполняет ту же разборку', () => {
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine
    const observer = { scenario: null } as unknown as ResourceObserver
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    new Application(engine, observer, new Scene(), leakDetector, heightFieldGate).dispose()

    expect(engine.dispose).toHaveBeenCalledTimes(1)
    expect(resourceStorage.deleteAllTextures).toHaveBeenCalledTimes(1)
  })

  it('свежее приложение не вызывает record() при первой разборке сессии', () => {
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine
    const observer = {} as unknown as ResourceObserver
    const recordSpy = vi.fn(() => null)
    const detector = { record: recordSpy } as unknown as LeakDetector
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    new Application(engine, observer, new Scene(), detector, heightFieldGate).teardown()

    expect(recordSpy).not.toHaveBeenCalled()
  })

  it('вызывает record() при разборке после того как сценарий уже был загружен', async () => {
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine
    const observer = {
      scenario: null,
      loadPrimaryTextures: vi.fn(() => Promise.resolve()),
      sceneBackground: new CubeTexture(),
      map: new Map()
    } as unknown as ResourceObserver
    const recordSpy = vi.fn(() => null)
    const detector = { record: recordSpy } as unknown as LeakDetector
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    const application = new Application(engine, observer, new Scene(), detector, heightFieldGate)
    await application.run(Scenarios[0])
    recordSpy.mockClear()

    application.teardown()

    expect(recordSpy).toHaveBeenCalledTimes(1)
  })

  it('повторная разборка свежего приложения тоже не вызывает record(), пока ничего не загружено', () => {
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine
    const observer = {} as unknown as ResourceObserver
    const recordSpy = vi.fn(() => null)
    const detector = { record: recordSpy } as unknown as LeakDetector
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    const application = new Application(engine, observer, new Scene(), detector, heightFieldGate)

    application.teardown()
    application.teardown()

    expect(recordSpy).not.toHaveBeenCalled()
  })

  it('после dispose() флаг загрузки не сбрасывается — следующая разборка снова вызывает record()', async () => {
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine
    const observer = {
      scenario: null,
      loadPrimaryTextures: vi.fn(() => Promise.resolve()),
      sceneBackground: new CubeTexture(),
      map: new Map()
    } as unknown as ResourceObserver
    const recordSpy = vi.fn(() => null)
    const detector = { record: recordSpy } as unknown as LeakDetector
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    const application = new Application(engine, observer, new Scene(), detector, heightFieldGate)
    await application.run(Scenarios[0])

    application.dispose()
    recordSpy.mockClear()

    application.teardown()

    expect(recordSpy).toHaveBeenCalledTimes(1)
  })
})
