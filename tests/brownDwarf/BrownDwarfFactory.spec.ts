import { Object3D, WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { BrownDwarf } from '@/core/renderables/BrownDwarf'
import { ResourceObserver } from '@/core/services/ResourceObserver'

const fakeRenderer = {
  domElement: { height: 1080 },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function stubActor(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => (key === 'categoryId' ? 8 : (def ?? 'Dwarf')),
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def)
    },
    // DynamicNode строит OrientationModel, а тот различает null (нет строки) и undefined
    // (свойства нет у стаба вовсе) не одинаково: только null читается как «данных нет»
    rotation: null
  } as unknown as Actor
}

function findBody(root: Object3D): BrownDwarf | undefined {
  let found: BrownDwarf | undefined

  root.traverse((child) => {
    if (child instanceof BrownDwarf) found = child
  })

  return found
}

describe('фабрика: коричневый карлик', () => {
  it('категория 8 собирается в узел с телом внутри', () => {
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver)
    const node = factory.make(stubActor())

    expect(findBody(node)).toBeInstanceOf(BrownDwarf)
  })
})
