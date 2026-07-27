import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Scene } from 'three'
import { Application } from '@/Application'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { Engine } from '@/core/Engine'
import type { ResourceObserver } from '@/core/services/ResourceObserver'

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

    new Application(engine, observer, new Scene()).teardown()

    expect(order).toEqual(['engine', 'textures'])
  })

  it('dispose() выполняет ту же разборку', () => {
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine
    const observer = { scenario: null } as unknown as ResourceObserver
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    new Application(engine, observer, new Scene()).dispose()

    expect(engine.dispose).toHaveBeenCalledTimes(1)
    expect(resourceStorage.deleteAllTextures).toHaveBeenCalledTimes(1)
  })
})
