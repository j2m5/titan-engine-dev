import { describe, it, expect } from 'vitest'
import { Vector2, WebGLRenderer } from 'three'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { Nebula } from '@/core/renderables/Nebula'
import { Actor } from '@/core/models/Actor'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'

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

function nebulaActor(
  data: NebulaRenderingData | null,
  placement: { x: number; y: number; z: number } | null = null
): Actor {
  return {
    placement:
      placement === null
        ? null
        : {
            getAttribute: (key: string, fallback = 0): number =>
              (placement as unknown as Record<string, number>)[key] ?? fallback
          },
    renderingObject: data === null ? null : { getAttribute: (): unknown => data },
    getAttribute: (key: string, fallback: unknown = ''): unknown => {
      if (key === 'categoryId') return 7
      if (key === 'name') return 'Horuset Nebula'
      return fallback
    }
  } as unknown as Actor
}

function makeFactory(): RenderableFactory {
  return new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry())
}

describe('RenderableFactory — туманность', () => {
  it('категория 7 собирается в PlacedNode с Nebula внутри', () => {
    const node = makeFactory().make(nebulaActor({ size: 100, quality: { bake3DTexture: false } }))

    expect(node).toBeInstanceOf(PlacedNode)
    expect(node.children.some((child) => child instanceof Nebula)).toBe(true)
    expect(node.name).toBe('Horuset Nebula')
  })

  it('конфиг из data доезжает до параметров туманности', () => {
    const node = makeFactory().make(nebulaActor({ size: 100, seed: 4242, quality: { bake3DTexture: false } }))
    const nebula = node.children.find((child) => child instanceof Nebula) as Nebula

    expect(nebula.params.seed).toBe(4242)
    expect(nebula.params.size).toBeCloseTo(fromAstronomicalUnits(100), 6)
  })

  it('placement сдвигает узел, а не саму туманность', () => {
    const node = makeFactory().make(
      nebulaActor({ size: 100, quality: { bake3DTexture: false } }, { x: 3, y: 0, z: 0 })
    )
    const nebula = node.children.find((child) => child instanceof Nebula) as Nebula

    expect(node.position.x).toBeCloseTo(fromAstronomicalUnits(3), 6)
    expect(nebula.position.toArray()).toEqual([0, 0, 0])
  })

  it('туманность без renderingObject падает с внятным сообщением', () => {
    expect(() => makeFactory().make(nebulaActor(null))).toThrow(/туманности/)
  })
})
