import { Texture } from 'three'
import { StarInnerLayer } from '@/core/renderables/utils/StarInnerLayer'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Actor } from '@/core/models/Actor'

function stubActor(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => def,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'temperature' ? 5700 : def)
    }
  } as unknown as Actor
}

describe('StarInnerLayer: порядок в transparent-проходе', () => {
  beforeEach(() => {
    const map = new Texture()
    map.name = 'sun.png'
    resourceStorage.addTexture(map)
  })

  afterEach(() => {
    resourceStorage.deleteTexture('sun.png')
  })

  it('ореол рисуется поверх билборда: контракт renderOrder, а не тайбрейк по id', () => {
    // Билборд FakeStar (NormalBlending, alpha=1 внутри диска) и ореол висят
    // в одной точке: при равном z сортировку решал порядок конструирования.
    // Перестановка строк в фабрике молча роняла бы ореол под билборд
    const layer = new StarInnerLayer(stubActor())

    expect(layer.renderOrder).toBe(1)
  })
})
