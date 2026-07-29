import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { Actor } from '@/core/models/Actor'

function stubStar(temperature: number): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown) => (key === 'temperature' ? temperature : 100)
    }
  } as unknown as Actor
}

describe('StarOuterLayer: пер-звёздные юниформы (клон, не шаблонные ссылки)', () => {
  it('два инстанса с разными температурами не разделяют объекты юниформов и имеют разные палитры', () => {
    const hot = new StarOuterLayer(stubStar(6400))
    const cool = new StarOuterLayer(stubStar(3500))

    expect(hot.material.uniforms.uColorBase).not.toBe(cool.material.uniforms.uColorBase)
    expect(hot.material.uniforms.uColorCool).not.toBe(cool.material.uniforms.uColorCool)
    expect(hot.material.uniforms.uColorBase.value.b).toBeGreaterThan(cool.material.uniforms.uColorBase.value.b)
  })
})
