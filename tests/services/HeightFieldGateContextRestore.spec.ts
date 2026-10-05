import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scene, type WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { HeightFieldGate } from '@/core/services/HeightFieldGate'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { SceneObserver } from '@/core/services/SceneObserver'
import { SyncTerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { heightPathOf } from '@/core/terrain/heightPath'
import { minBodyPixelsToPriorityThreshold } from '@/core/streaming/angularCutoff'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'

/**
 * После `webglcontextrestored` three пересоздаёт GL-ресурсы и перезаливает
 * каждый буфер из `attribute.array`, а слоты пула рельефа держат после заливки
 * только position (см. докблок TerrainPatchPool): отпущенные массивы дали бы
 * нулевые буферы — дыры в рельефе, а следующий приход в такой слот падает
 * внутри рендера «Resizing buffer attributes is not supported». Гейт обязан
 * сбросить поверхности-рельеф на легаси-сферу, пока пулы живы, и дать им
 * перестроиться со свежими пулами.
 */

const MOON_ID: number = 19
const NOMINAL_HEIGHT: number = 1080

type FactoryStub = {
  upgradePlanetToTerrain: ReturnType<typeof vi.fn>
  downgradeTerrainToPlanet: ReturnType<typeof vi.fn>
  resyncSurfaceMaterials: ReturnType<typeof vi.fn>
}

/** Настоящий EventTarget в роли canvas: gate вешает слушатель на renderer.domElement. */
function makeRenderer(): { renderer: WebGLRenderer; canvas: EventTarget } {
  const canvas = Object.assign(new EventTarget(), { height: NOMINAL_HEIGHT })

  return { renderer: { domElement: canvas } as unknown as WebGLRenderer, canvas }
}

function makeStand(swapped: (node: DynamicNode) => boolean): {
  gate: HeightFieldGate
  observer: SceneObserver
  factory: FactoryStub
  canvas: EventTarget
  nodes: DynamicNode[]
} {
  const scene = new Scene()
  const nodes: DynamicNode[] = []

  for (const id of [MOON_ID, 23]) {
    const actor: Actor = Actor.find(id)!
    const node = new DynamicNode(actor)

    node.name = actor.getAttribute('name', '')
    scene.add(node)
    nodes.push(node)
  }

  const observer = new SceneObserver()
  const factory: FactoryStub = {
    upgradePlanetToTerrain: vi.fn(() => false),
    downgradeTerrainToPlanet: vi.fn(swapped),
    resyncSurfaceMaterials: vi.fn()
  }
  const { renderer, canvas } = makeRenderer()
  const gate = new HeightFieldGate(observer, scene, factory as never, renderer, new SyncTerrainPatchBuilder())

  return { gate, observer, factory, canvas, nodes }
}

function restoreContext(canvas: EventTarget): void {
  canvas.dispatchEvent(new Event('webglcontextrestored'))
}

afterEach(() => {
  heightFieldStorage.clear()
  vi.restoreAllMocks()
})

describe('HeightFieldGate: восстановление WebGL-контекста', () => {
  it('webglcontextrestored даунгрейдит каждый узел сцены и ресинкает материалы только подменённых', () => {
    const { observer, factory, canvas, nodes } = makeStand((node) => node === nodes[0])
    const refresh = vi.spyOn(observer, 'refreshObservableObjects')

    restoreContext(canvas)

    expect(factory.downgradeTerrainToPlanet).toHaveBeenCalledTimes(2)
    expect(factory.downgradeTerrainToPlanet).toHaveBeenCalledWith(nodes[0])
    expect(factory.downgradeTerrainToPlanet).toHaveBeenCalledWith(nodes[1])
    expect(factory.resyncSurfaceMaterials).toHaveBeenCalledTimes(1)
    expect(factory.resyncSurfaceMaterials).toHaveBeenCalledWith(nodes[0])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('если свапа не было, снимок наблюдения не перестраивается и материалы не ресинкаются', () => {
    const { observer, factory, canvas } = makeStand(() => false)
    const refresh = vi.spyOn(observer, 'refreshObservableObjects')

    restoreContext(canvas)

    expect(factory.downgradeTerrainToPlanet).toHaveBeenCalledTimes(2)
    expect(factory.resyncSurfaceMaterials).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('после даунгрейда запускается пересчёт гейта — и только после него', () => {
    const { gate, factory, canvas } = makeStand(() => true)
    const order: string[] = []

    factory.downgradeTerrainToPlanet.mockImplementation(() => {
      order.push('downgrade')

      return true
    })
    vi.spyOn(gate, 'recompute').mockImplementation(() => {
      order.push('recompute')
    })

    restoreContext(canvas)

    expect(order).toEqual(['downgrade', 'downgrade', 'recompute'])
  })

  it('тело с уже загруженной картой после восстановления апгрейдится заново (свежие пулы)', () => {
    const { observer, factory, canvas, nodes } = makeStand(() => true)
    const moon: Actor = Actor.find(MOON_ID)!
    const radiusUnits: number = toThreeJSUnits(moon.physicalObject!.getAttribute('radius')!)
    const priority: number = minBodyPixelsToPriorityThreshold(config('terrain.heightMapLoadPixels') * 2, config('camera.fov'), NOMINAL_HEIGHT)

    heightFieldStorage['maps'].set(heightPathOf(moon)!, { width: 4, height: 2, minMeters: 0, maxMeters: 1000, data: new Uint16Array(8).fill(32768) })
    observer.data.set(nodes[0].name, { name: nodes[0].name, distance: radiusUnits / priority, position: undefined as never })

    restoreContext(canvas)

    expect(factory.upgradePlanetToTerrain).toHaveBeenCalledWith(nodes[0])
    const downgrade: number = factory.downgradeTerrainToPlanet.mock.invocationCallOrder[0]
    const upgrade: number = factory.upgradePlanetToTerrain.mock.invocationCallOrder[0]

    expect(downgrade).toBeLessThan(upgrade)
  })

  it('после dispose событие контекста ничего не вызывает', () => {
    const { gate, factory, canvas } = makeStand(() => true)
    const recompute = vi.spyOn(gate, 'recompute')

    gate.dispose()
    restoreContext(canvas)

    expect(factory.downgradeTerrainToPlanet).not.toHaveBeenCalled()
    expect(recompute).not.toHaveBeenCalled()
  })
})
