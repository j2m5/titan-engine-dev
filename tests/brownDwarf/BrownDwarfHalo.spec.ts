import { Sprite, Texture, WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
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
      key === 'categoryId' ? 8 : key === 'name' ? 'Dwarf' : def,
    // Именно null, а не отсутствие поля: OrientationModel проверяет `!== null`
    rotation: null,
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 69900 : key === 'temperature' ? 1210 : def
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

describe('ореол коричневого карлика', () => {
  beforeEach(() => {
    const map = new Texture()
    map.name = 'sun.png'
    resourceStorage.addTexture(map)
  })

  afterEach(() => {
    resourceStorage.deleteTexture('sun.png')
  })

  it('спрайт висит на LOD, а не на теле: он нужен и на дальнем уровне', () => {
    // На дистанции переключения тело меньше пикселя, и блуму работать не с
    // чем — ореол там и остаётся единственным следом объекта
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new DepthVolumeRegistry())
    const halo = findHalo(factory.make(stubActor()))

    expect(halo).toBeInstanceOf(Sprite)
    expect(halo!.parent).toBeInstanceOf(ApparentSizeLod)
  })

  it('карлик тлеет тише звезды', () => {
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new DepthVolumeRegistry())
    const halo = findHalo(factory.make(stubActor()))

    expect(halo!.material.opacity).toBeCloseTo(config('brownDwarf.haloOpacity'))
    expect(config('brownDwarf.haloOpacity')).toBeLessThan(0.03)
  })

  it('дефолт звезды не сдвинут появлением параметра', () => {
    // Прозрачность стала аргументом ради карлика; звезда обязана остаться
    // ровно там, где была
    expect(new StarInnerLayer(stubActor()).material.opacity).toBeCloseTo(0.03)
  })

  it('нулевая прозрачность гасит слой — точка отката', () => {
    expect(new StarInnerLayer(stubActor(), 0.8, 0).material.opacity).toBe(0)
  })
})
