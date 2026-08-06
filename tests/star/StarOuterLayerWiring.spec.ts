import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { Actor } from '@/core/models/Actor'
import { StarOuterLayerShaderTemplate } from '@/core/materials/shaders/lib/StarOuterLayerShaderTemplate'
import { buildProminenceGeometry } from '@/core/renderables/utils/prominenceGeometry'

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

describe('StarOuterLayer: имена атрибутов геометрии и шейдера совпадают', () => {
  it('множество attribute вершинного шейдера равно множеству атрибутов геометрии', () => {
    // Рассинхрон этих двух файлов не ловится ничем: WebGL просто не найдёт
    // атрибут, и ленты станут чёрными или схлопнутся в точку
    const geometry = buildProminenceGeometry({ ribbonCount: 2, segmentsPerRibbon: 2 })
    const declared: string[] = [
      ...StarOuterLayerShaderTemplate.vertexShader.matchAll(/attribute\s+\w+\s+(\w+)\s*;/g)
    ].map((match) => match[1])

    expect(declared.length).toBeGreaterThan(0)
    expect(new Set(declared)).toEqual(new Set(Object.keys(geometry.attributes)))
  })
})
