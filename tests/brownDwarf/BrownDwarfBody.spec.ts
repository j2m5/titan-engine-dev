import { PerspectiveCamera, WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { BrownDwarf } from '@/core/renderables/BrownDwarf/BrownDwarf'
import { BrownDwarfShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfShaderTemplate'

const fakeRenderer = {
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function stubActor(): Actor {
  return {
    getAttribute: (_key: string, def?: unknown): unknown => def ?? 'Dwarf',
    renderingObject: { getAttribute: () => ({ bandCount: 9 }) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def)
    }
  } as unknown as Actor
}

describe('тело коричневого карлика', () => {
  it('строится и несёт запечённую кубмапу в юниформе', () => {
    const body = new BrownDwarf(stubActor(), fakeRenderer)

    expect(body.material.uniforms.uClouds.value).toBeTruthy()
    expect(body.userData.type).toBe('brownDwarf')
    expect(body.userData.clickable).toBe(true)

    body.dispose()
  })

  it('время доезжает в юниформ и не трогает толщу', () => {
    const body = new BrownDwarf(stubActor(), fakeRenderer)
    const before = body.material.uniforms.uOpticalDepth.value

    body.updateObject({ delta: 0.016, epoch: 0, elapsed: 9999, camera: new PerspectiveCamera() })

    expect(body.material.uniforms.time.value).toBeCloseTo(9999)
    expect(body.material.uniforms.uOpticalDepth.value).toBe(before)

    body.dispose()
  })

  it('шаблон не держит собственной копии формул композиции', () => {
    // Дубль формулы — это будущая рассинхронизация LOD при первой правке
    expect(BrownDwarfShaderTemplate.fragmentShader).toContain('#include <brownDwarfSurface>')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('float bdTransmit(')
  })

  it('вся композиция идёт одной точкой входа чанка', () => {
    // Собственных вызовов примитивов в шаблоне нет — иначе диск и импостор
    // могут разойтись порядком операций или забытым дыханием
    expect(BrownDwarfShaderTemplate.fragmentShader).toContain('bdShade(')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('bdTransmit(')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('bdCompose(')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('smoothstep')
  })

  it('dispose освобождает запекатель', () => {
    const body = new BrownDwarf(stubActor(), fakeRenderer)
    const targets = body.bakerForTest.targetsForTest

    body.dispose()

    // цели освобождены: повторный dispose не должен падать
    expect(() => body.dispose()).not.toThrow()
    expect(targets).toHaveLength(2)
  })
})
