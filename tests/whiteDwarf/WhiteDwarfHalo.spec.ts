import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Sprite, Texture, WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { StarInnerLayer } from '@/core/renderables/utils/StarInnerLayer'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { config } from '@/core/framework/config'

const fakeRenderer = {
  domElement: { height: 1080 },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function stubActor(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown =>
      key === 'categoryId' ? 9 : key === 'name' ? 'Sirius B' : def,
    rotation: null,
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 5850 : key === 'temperature' ? 25200 : def
    }
  } as unknown as Actor
}

function findHalo(root: { traverse: (cb: (o: unknown) => void) => void }): StarInnerLayer | undefined {
  let found: StarInnerLayer | undefined

  root.traverse((child: unknown): void => {
    if (child instanceof StarInnerLayer) found = child
  })

  return found
}

describe('ореол белого карлика', () => {
  beforeEach(() => {
    const map = new Texture()
    map.name = 'sun.png'
    resourceStorage.addTexture(map)
  })

  afterEach(() => {
    resourceStorage.deleteTexture('sun.png')
  })

  it('спрайт висит на LOD, а не на теле', () => {
    // У карлика это несущая деталь, а не украшение: с 1 а.е. его угловой размер
    // около 17 угловых секунд против 1919 у Солнца, и порога в 12 пикселей диск
    // достигает лишь примерно с 1.3 млн км. Всё остальное время виден ореол
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver)
    const halo = findHalo(factory.make(stubActor()))

    expect(halo).toBeInstanceOf(Sprite)
    expect(halo!.parent).toBeInstanceOf(ApparentSizeLod)
  })

  it('горит ярче звёздного и туже коричневого', () => {
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver)
    const halo = findHalo(factory.make(stubActor()))

    expect(halo!.material.opacity).toBeCloseTo(config('whiteDwarf.haloOpacity'))
    expect(config('whiteDwarf.haloOpacity')).toBeGreaterThan(config('brownDwarf.haloOpacity'))
  })

  it('цвет ореола идёт от температуры тела и уходит в синеву', () => {
    // StarInnerLayer красит спрайт через colorTemperatureToRGB. При 25 200 K
    // синий обязан быть выше красного — если сравнение перевернётся, значит
    // температуру до слоя не донесли и он взял солнечный дефолт
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver)
    const halo = findHalo(factory.make(stubActor()))

    expect(halo!.material.color.b).toBeGreaterThan(halo!.material.color.r)
  })

  it('дефолт звезды не сдвинут', () => {
    expect(new StarInnerLayer(stubActor()).material.opacity).toBeCloseTo(0.03)
  })
})
