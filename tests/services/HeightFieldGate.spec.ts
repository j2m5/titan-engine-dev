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

/**
 * Тело стенда — либо актор (узел зовётся его именем в БД), либо пара
 * «актор + имя узла». Вторая форма нужна тестам общей карты высот: гейт
 * различает тела ТОЛЬКО по имени узла в сцене, а путь карты берёт из
 * `node.model` — два узла над одним актором дают ровно тот же стык, что два
 * разных тела с одинаковым height-ресурсом, без фикстуры в БД.
 */
type StandBody = Actor | { actor: Actor; name: string }

function bodyActor(body: StandBody): Actor {
  return body instanceof Actor ? body : body.actor
}

function bodyName(body: StandBody): string {
  return body instanceof Actor ? body.getAttribute('name', '') : body.name
}

/**
 * Стенд: сцена с узлами перечисленных тел, наблюдатель и заглушка фабрики.
 * `factoryOverrides` подменяет возвращаемое значение операций фабрики —
 * по умолчанию обе идемпотентно отвечают «ничего не поменялось».
 */
function makeStand(
  bodies: StandBody[],
  factoryOverrides?: Partial<{ upgrade: boolean; downgrade: boolean }>
): { gate: HeightFieldGate; observer: SceneObserver; factory: FactoryStub } {
  const scene = new Scene()

  for (const body of bodies) {
    const node = new DynamicNode(bodyActor(body))

    node.name = bodyName(body)
    scene.add(node)
  }

  const observer = new SceneObserver()
  const factory: FactoryStub = {
    upgradePlanetToTerrain: vi.fn(() => factoryOverrides?.upgrade ?? false),
    downgradeTerrainToPlanet: vi.fn(() => factoryOverrides?.downgrade ?? false)
  }

  const gate = new HeightFieldGate(observer, scene, factory as never)

  return { gate, observer, factory }
}

/** Кладёт тело в наблюдение на дистанции, дающей нужный видимый размер. */
function observeAt(observer: SceneObserver, body: StandBody, pixels: number): void {
  const name: string = bodyName(body)

  observer.data.set(name, {
    name,
    distance: distanceForPixels(bodyActor(body), pixels),
    position: undefined as never
  })
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

describe('HeightFieldGate: пересбор снимка наблюдения после свапа поверхности', () => {
  it('апгрейд или даунгрейд поверхности перестраивает снимок наблюдения ОДИН раз за пересчёт', () => {
    const moon: Actor = Actor.find(MOON_ID)!
    const callisto: Actor = Actor.find(23)!
    const { gate, observer, factory } = makeStand([moon, callisto], { upgrade: true })
    const refresh = vi.spyOn(observer, 'refreshObservableObjects')

    heightFieldStorage['maps'].set(heightPathOf(moon)!, flatMap())
    heightFieldStorage['maps'].set(heightPathOf(callisto)!, flatMap())
    observeAt(observer, moon, config('terrain.heightMapLoadPixels') * 2)
    observeAt(observer, callisto, config('terrain.heightMapLoadPixels') * 2)

    gate.recompute()

    expect(factory.upgradePlanetToTerrain).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('без апгрейда и даунгрейда снимок наблюдения не перестраивается', () => {
    const moon: Actor = Actor.find(MOON_ID)!
    const { gate, observer } = makeStand([moon])
    const refresh = vi.spyOn(observer, 'refreshObservableObjects')

    observeAt(observer, moon, config('terrain.heightMapLoadPixels') * 2)
    gate.recompute()

    expect(refresh).not.toHaveBeenCalled()
  })
})

/**
 * Находка №2 финального ревью ветки: индекс «путь → узел» был одиночным
 * значением, и при общей карте высот последний кандидат затирал предыдущих —
 * все, кроме него, не получали ни апгрейда, ни даунгрейда НИКОГДА. Общая
 * карта легальна по дизайну сразу в двух местах: политика схлопывает дубли
 * пути по максимуму приоритета, а terrainHeightFieldFor кэширует поле по паре
 * «карта + радиус» именно ради вымышленных лун разных радиусов на одной
 * карте. В БД такой пары сегодня нет — стенд воспроизводит стык двумя узлами
 * над одним актором (см. StandBody).
 */
describe('HeightFieldGate: общая карта высот у нескольких тел', () => {
  /** Два узла сцены над одним актором: один путь карты, разные имена. */
  function sharedBodies(): { actor: Actor; name: string }[] {
    const moon: Actor = Actor.find(MOON_ID)!

    return [
      { actor: moon, name: 'ОбщаяКартаПервое' },
      { actor: moon, name: 'ОбщаяКартаВторое' }
    ]
  }

  it('апгрейдятся ВСЕ тела на общей карте, а не только последнее', () => {
    const bodies = sharedBodies()
    const { gate, observer, factory } = makeStand(bodies, { upgrade: true })

    heightFieldStorage['maps'].set(heightPathOf(bodies[0].actor)!, flatMap())
    for (const body of bodies) observeAt(observer, body, config('terrain.heightMapLoadPixels') * 2)

    gate.recompute()

    expect(factory.upgradePlanetToTerrain).toHaveBeenCalledTimes(2)
  })

  it('даунгрейдятся ВСЕ тела на общей карте до того, как она покинет реестр', () => {
    const bodies = sharedBodies()
    const { gate, observer, factory } = makeStand(bodies, { downgrade: true })
    const path: string = heightPathOf(bodies[0].actor)!

    heightFieldStorage['maps'].set(path, flatMap())
    for (const body of bodies) observeAt(observer, body, 1)

    gate.recompute()

    expect(factory.downgradeTerrainToPlanet).toHaveBeenCalledTimes(2)
    expect(heightFieldStorage.get(path)).toBeUndefined()
  })
})
