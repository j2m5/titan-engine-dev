import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CubeTexture, Scene } from 'three'
import { Application } from '@/Application'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Scenarios } from '@/config/scenarios'
import type { Actor } from '@/core/models/Actor'
import type { Engine } from '@/core/Engine'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import type { LeakDetector } from '@/core/lifecycle/LeakDetector'

const leakDetector = { record: () => null } as unknown as LeakDetector
const heightFieldGate = { recompute: vi.fn(), dispose: vi.fn() } as never

/**
 * Актор сценария глазами отбора: запросы к связям сужены по ключу и значению —
 * стаб, отвечающий на любой where, доказывал бы отбор и при неверном запросе.
 */
function stubActor(hasAtmosphere: boolean, heightPath: string | null): Actor {
  return {
    children: {
      where: (key: string, value: number) => ({
        isEmpty: () => !(hasAtmosphere && key === 'categoryId' && value === 5)
      })
    },
    resources: {
      where: (key: string, value: string) => ({
        first: () =>
          heightPath !== null && key === 'resourceType' && value === 'height'
            ? { getAttribute: () => heightPath }
            : undefined
      })
    }
  } as unknown as Actor
}

function stubObserver(map: Map<number, Actor>): ResourceObserver {
  return {
    scenario: null,
    loadPrimaryTextures: vi.fn(() => Promise.resolve()),
    sceneBackground: new CubeTexture(),
    map
  } as unknown as ResourceObserver
}

describe('Application.run: предзагрузка заголовков карт высот', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})
  })

  it('заголовки просят только у тел с атмосферой И картой высот', async () => {
    const preload = vi.spyOn(heightFieldStorage, 'preloadHeaders').mockResolvedValue(undefined)
    const map = new Map<number, Actor>([
      [1, stubActor(true, 'planets/mars/mars_height.raw')], // атмосфера + карта
      [2, stubActor(false, 'planets/moon/moon_height.raw')], // карта без атмосферы
      [3, stubActor(true, null)] // атмосфера без карты
    ])
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine

    await new Application(engine, stubObserver(map), new Scene(), leakDetector, heightFieldGate).run(Scenarios[0])

    expect(preload).toHaveBeenCalledTimes(1)
    expect(preload).toHaveBeenCalledWith(['planets/mars/mars_height.raw'])
  })

  it('заголовки приезжают ДО старта движка — атмосфера читает пол в конструкторе', async () => {
    const order: string[] = []
    vi.spyOn(heightFieldStorage, 'preloadHeaders').mockImplementation(async () => {
      order.push('headers')
    })
    const engine = {
      dispose: vi.fn(),
      start: vi.fn(() => {
        order.push('start')
      })
    } as unknown as Engine
    const map = new Map<number, Actor>([[1, stubActor(true, 'planets/mars/mars_height.raw')]])

    await new Application(engine, stubObserver(map), new Scene(), leakDetector, heightFieldGate).run(Scenarios[0])

    expect(order).toEqual(['headers', 'start'])
  })

  it('общая карта высот у двух тел с атмосферой — один путь, не два', async () => {
    const preload = vi.spyOn(heightFieldStorage, 'preloadHeaders').mockResolvedValue(undefined)
    const shared = 'planets/unnamed/twins_height.raw'
    const map = new Map<number, Actor>([
      [1, stubActor(true, shared)],
      [2, stubActor(true, shared)]
    ])
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine

    await new Application(engine, stubObserver(map), new Scene(), leakDetector, heightFieldGate).run(Scenarios[0])

    expect(preload).toHaveBeenCalledWith([shared])
  })

  it('сценарий без тел с атмосферой — вызов с пустым списком, сети нет', async () => {
    const preload = vi.spyOn(heightFieldStorage, 'preloadHeaders').mockResolvedValue(undefined)
    const map = new Map<number, Actor>([[1, stubActor(false, 'planets/moon/moon_height.raw')]])
    const engine = { dispose: vi.fn(), start: vi.fn() } as unknown as Engine

    await new Application(engine, stubObserver(map), new Scene(), leakDetector, heightFieldGate).run(Scenarios[0])

    expect(preload).toHaveBeenCalledWith([])
  })
})
