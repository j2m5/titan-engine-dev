import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Vector2, WebGLRenderer } from 'three'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { AsteroidRingSystem, type AsteroidRingConfig } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import type { UpdateContext } from '@/core/UpdateContext'

/** WebGL-контекста в jsdom нет; фабрике от рендерера нужны только эти вызовы */
const fakeRenderer = {
  getSize: (v: Vector2) => {
    v.set(1920, 1080)
    return v
  },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function makeFactory(): RenderableFactory {
  return new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new DepthVolumeRegistry())
}

function beltActor(data: IAsteroidBeltRenderingObject): Actor {
  return {
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (key: string, fallback: unknown = ''): unknown => {
      if (key === 'categoryId') return 11
      if (key === 'name') return 'Ashfall Belt'
      return fallback
    }
  } as unknown as Actor
}

/** Приватные поля AsteroidBelt, к которым обращаются тесты (см. tests/helpers/ringSystemInternals.ts) */
type BeltInternals = { streamer: AsteroidRingSystem | null }
const internalsOf = (belt: AsteroidBelt): BeltInternals => belt as unknown as BeltInternals
const configOf = (system: AsteroidRingSystem): AsteroidRingConfig =>
  (system as unknown as { config: AsteroidRingConfig }).config

/** Один кадр узла с камерой в точке world (x, y, 0) */
function frameAt(belt: AsteroidBelt, x: number, y: number = 0): void {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)
  camera.position.set(x, y, 0)
  camera.updateMatrixWorld(true)

  belt.updateObject({ delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext)
}

// Тор 40..60 а.е., тонкий (0.1 а.е.) — высотный избыток легко перекрывает
// малый near-порог (доли а.е. от meanSpacingKm), но не дотягивает до mid (1 а.е.)
const BELT_DATA: IAsteroidBeltRenderingObject = {
  innerRadiusAu: 40,
  outerRadiusAu: 60,
  thicknessAu: 0.1,
  meanSpacingKm: 60,
  dustEnabled: false
}

describe('RenderableFactory — пояс астероидов', () => {
  it('категория 11 собирается в PlacedNode с AsteroidBelt внутри, без renderable', () => {
    const node = makeFactory().make(beltActor(BELT_DATA))

    expect(node).toBeInstanceOf(PlacedNode)
    expect((node as PlacedNode).renderable).toBeNull()
    expect(node.children.some((child) => child instanceof AsteroidBelt)).toBe(true)
    expect(node.name).toBe('Ashfall Belt')
  })
})

describe('AsteroidBelt — состояния LOD по расстоянию до тора', () => {
  it('камера далеко от пояса (100 а.е.) — состояние Far, стример не создан', () => {
    const node = makeFactory().make(beltActor(BELT_DATA)) as PlacedNode
    const belt = node.children.find((c) => c instanceof AsteroidBelt) as unknown as AsteroidBelt
    node.updateMatrixWorld(true)

    frameAt(belt, fromAstronomicalUnits(100))

    expect(internalsOf(belt).streamer).toBeNull()
  })

  it('камера внутри тора в плоскости (50 а.е.) — Near, стример создан с planetRadiusKm=0/system/relativeOrigin', () => {
    const node = makeFactory().make(beltActor(BELT_DATA)) as PlacedNode
    const belt = node.children.find((c) => c instanceof AsteroidBelt) as unknown as AsteroidBelt
    node.updateMatrixWorld(true)

    frameAt(belt, fromAstronomicalUnits(100)) // сперва далеко — Far
    frameAt(belt, fromAstronomicalUnits(50)) // затем внутрь тора

    const streamer = internalsOf(belt).streamer
    expect(streamer).not.toBeNull()
    expect(streamer!.visible).toBe(true)

    const cfg = configOf(streamer!)
    expect(cfg.planetRadiusKm).toBe(0)
    expect(cfg.frame).toBe('system')
    expect(cfg.relativeOrigin).toBe(true)
  })

  it('уход на 55 а.е. + 0.2 а.е. над плоскостью — Mid, стример скрыт, но не уничтожен', () => {
    const node = makeFactory().make(beltActor(BELT_DATA)) as PlacedNode
    const belt = node.children.find((c) => c instanceof AsteroidBelt) as unknown as AsteroidBelt
    node.updateMatrixWorld(true)

    frameAt(belt, fromAstronomicalUnits(50)) // Near — стример создаётся
    const streamerAfterNear = internalsOf(belt).streamer
    expect(streamerAfterNear).not.toBeNull()

    frameAt(belt, fromAstronomicalUnits(55), fromAstronomicalUnits(0.2)) // Mid

    const streamer = internalsOf(belt).streamer
    expect(streamer).toBe(streamerAfterNear) // тот же объект — не пересоздан
    expect(streamer!.visible).toBe(false)
  })

  it('стример при собственном дальнем слое пыли пояса получает dustEnabled: false', () => {
    const node = makeFactory().make(beltActor({ ...BELT_DATA, dustEnabled: true })) as PlacedNode
    const belt = node.children.find((c) => c instanceof AsteroidBelt) as unknown as AsteroidBelt
    node.updateMatrixWorld(true)

    frameAt(belt, fromAstronomicalUnits(50))

    const streamer = internalsOf(belt).streamer!
    expect(configOf(streamer).dustEnabled).toBe(false)
  })
})
