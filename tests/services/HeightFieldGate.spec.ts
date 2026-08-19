import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scene } from 'three'
import { Actor } from '@/core/models/Actor'
import { SceneObserver } from '@/core/services/SceneObserver'
import { HeightFieldGate } from '@/core/services/HeightFieldGate'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { minBodyPixelsToPriorityThreshold } from '@/core/streaming/angularCutoff'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

const MOON_ID: number = 19

type FactoryStub = {
  upgradePlanetToTerrain: ReturnType<typeof vi.fn>
  downgradeTerrainToPlanet: ReturnType<typeof vi.fn>
}

function flatMap(): HeightMapData {
  return { width: 4, height: 2, minMeters: 0, maxMeters: 1000, data: new Uint16Array(8).fill(32768) }
}

/**
 * Дистанция, на которой видимый диаметр тела равен заданному числу пикселей:
 * обратная к actorPriority = radiusUnits / distance.
 */
function distanceForPixels(actor: Actor, pixels: number): number {
  const radiusUnits: number = toThreeJSUnits(actor.physicalObject!.getAttribute('radius')!)

  return radiusUnits / minBodyPixelsToPriorityThreshold(pixels)
}

/** Стенд: сцена с узлами перечисленных тел, наблюдатель и заглушка фабрики. */
function makeStand(actors: Actor[]): { gate: HeightFieldGate; observer: SceneObserver; factory: FactoryStub } {
  const scene = new Scene()

  for (const actor of actors) {
    const node = new DynamicNode(actor)

    node.name = actor.getAttribute('name', '')
    scene.add(node)
  }

  const observer = new SceneObserver()
  const factory: FactoryStub = {
    upgradePlanetToTerrain: vi.fn(() => false),
    downgradeTerrainToPlanet: vi.fn(() => false)
  }

  const gate = new HeightFieldGate(observer, scene, factory as never)

  return { gate, observer, factory }
}

/** Кладёт тело в наблюдение на дистанции, дающей нужный видимый размер. */
function observeAt(observer: SceneObserver, actor: Actor, pixels: number): void {
  const name: string = actor.getAttribute('name', '')

  observer.data.set(name, { name, distance: distanceForPixels(actor, pixels), position: undefined as never })
}

afterEach(() => {
  heightFieldStorage.clear()
  vi.restoreAllMocks()
})

describe('HeightFieldGate: запрос и освобождение карт по дистанции', () => {
  it('близкое тело запрашивает свою карту', () => {
    const moon: Actor = Actor.find(MOON_ID)!
    const { gate, observer } = makeStand([moon])
    const request = vi.spyOn(heightFieldStorage, 'request')

    observeAt(observer, moon, config('terrain.heightMapLoadPixels') * 2)
    gate.recompute()

    expect(request).toHaveBeenCalledWith(heightPathOf(moon))
  })

  it('далёкое тело карту не запрашивает', () => {
    const moon: Actor = Actor.find(MOON_ID)!
    const { gate, observer } = makeStand([moon])
    const request = vi.spyOn(heightFieldStorage, 'request')

    observeAt(observer, moon, 1)
    gate.recompute()

    expect(request).not.toHaveBeenCalled()
  })

  it('ушедшее далеко тело отпускает карту и даунгрейдится', () => {
    const moon: Actor = Actor.find(MOON_ID)!
    const { gate, observer, factory } = makeStand([moon])
    const path: string = heightPathOf(moon)!
    heightFieldStorage['maps'].set(path, flatMap())

    observeAt(observer, moon, 1)
    gate.recompute()

    expect(heightFieldStorage.get(path)).toBeUndefined()
    expect(factory.downgradeTerrainToPlanet).toHaveBeenCalled()
  })

  it('приехавшая карта апгрейдит узел', () => {
    const moon: Actor = Actor.find(MOON_ID)!
    const { gate, observer, factory } = makeStand([moon])
    heightFieldStorage['maps'].set(heightPathOf(moon)!, flatMap())

    observeAt(observer, moon, config('terrain.heightMapLoadPixels') * 2)
    gate.recompute()

    expect(factory.upgradePlanetToTerrain).toHaveBeenCalled()
  })

  it('тело без height-ресурса игнорируется', () => {
    // Солнце (actorId 4) height-ресурса не имеет — проверено по
    // storage/database/actorResource.ts
    const sun: Actor = Actor.find(4)!
    const { gate, observer } = makeStand([sun])
    const request = vi.spyOn(heightFieldStorage, 'request')

    observeAt(observer, sun, 1000)
    gate.recompute()

    expect(request).not.toHaveBeenCalled()
  })

  it('dispose снимает подписку: последующий ClosestChange ничего не считает', () => {
    const moon: Actor = Actor.find(MOON_ID)!
    const { gate, observer } = makeStand([moon])
    const request = vi.spyOn(heightFieldStorage, 'request')

    observeAt(observer, moon, config('terrain.heightMapLoadPixels') * 2)
    gate.dispose()
    observer.emit('ClosestChange', { name: 'x', distance: 1, position: undefined as never })

    expect(request).not.toHaveBeenCalled()
  })
})
