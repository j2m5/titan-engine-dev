import { RGFormat, UnsignedByteType, WebGLRenderer } from 'three'
import { BrownDwarfCloudBaker } from '@/core/renderables/BrownDwarf/BrownDwarfCloudBaker'

interface RenderCall {
  target: unknown
  face: number | undefined
}

function fakeRenderer(): { renderer: WebGLRenderer; calls: RenderCall[] } {
  const calls: RenderCall[] = []
  let current: unknown = null

  const renderer = {
    getRenderTarget: () => current,
    setRenderTarget: (target: unknown, face?: number) => {
      current = target
      if (target !== null) calls.push({ target, face })
    },
    render: () => {}
  } as unknown as WebGLRenderer

  return { renderer, calls }
}

const PARAMS = {
  seed: 4096,
  bandCount: 9,
  jetStrength: 0.6,
  turbulence: 1.6,
  size: 64,
  steps: 3,
  injection: 0.05
}

describe('запекатель облачного поля', () => {
  it('создаёт цель заявленного размера и формата, с мипами', () => {
    const { renderer } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)
    const texture = baker.bake()

    // Размер спрашиваем у цели, а не у текстуры: у CubeTexture поле image —
    // МАССИВ из шести описателей граней, поэтому texture.image.width равен
    // undefined на любом WebGLCubeRenderTarget
    expect(baker.targetsForTest[0].width).toBe(64)
    expect(texture.image).toHaveLength(6)
    expect(texture.image[0].width).toBe(64)

    expect(texture.format).toBe(RGFormat)
    expect(texture.type).toBe(UnsignedByteType)
    expect(texture.generateMipmaps).toBe(true)

    baker.dispose()
  })

  it('гоняет посев, адвекцию и финализацию по всем шести граням', () => {
    const { renderer, calls } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    // (посев + steps адвекции + финализация) × 6 граней
    expect(calls).toHaveLength((1 + PARAMS.steps + 1) * 6)
    expect(new Set(calls.map((c) => c.face))).toEqual(new Set([0, 1, 2, 3, 4, 5]))

    baker.dispose()
  })

  it('адвекция идёт ping-pong: соседние проходы пишут в разные цели', () => {
    const { renderer, calls } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    // проходы сгруппированы по шесть граней; берём первую грань каждого прохода
    const perPass = calls.filter((_, i) => i % 6 === 0).map((c) => c.target)

    for (let i = 1; i < perPass.length; i++) {
      expect(perPass[i]).not.toBe(perPass[i - 1])
    }

    baker.dispose()
  })

  it('возвращает рендерер на прежнюю цель', () => {
    const { renderer } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    expect(renderer.getRenderTarget()).toBeNull()

    baker.dispose()
  })

  it('dispose освобождает обе ping-pong цели', () => {
    const { renderer } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    const disposed: unknown[] = []
    for (const target of baker.targetsForTest) {
      const original = target.dispose.bind(target)
      target.dispose = () => {
        disposed.push(target)
        original()
      }
    }

    baker.dispose()

    expect(disposed).toHaveLength(2)
  })
})
