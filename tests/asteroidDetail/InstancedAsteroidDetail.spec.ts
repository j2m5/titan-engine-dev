import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { AbstractShader, ShaderProps } from '@/core/materials/shaders/AbstractShader'

class TestShader extends AbstractShader {
  public constructor(props: ShaderProps) {
    super(props)
  }
}

describe('InstancedAsteroidShaderTemplate: трипланарный PBR-микрослой', () => {
  it('фрагментник вызывает трипланарные выборки за флагом uDetailMapsEnabled', () => {
    const f = InstancedAsteroidShaderTemplate.fragmentShader
    expect(f).toContain('uDetailMapsEnabled > 0.5')
    expect(f).toContain('triplanarWeights')
    expect(f).toContain('triplanarAlbedo')
    expect(f).toContain('triplanarNormal')
    expect(f).toContain('triplanarArm')
  })

  it('включает чанк и резолвит его через AbstractShader', () => {
    expect(InstancedAsteroidShaderTemplate.fragmentShader).toContain('#include <triplanarDetailFunctions>')
    const shader = new TestShader(InstancedAsteroidShaderTemplate)
    expect(shader.fragmentShader).toContain('vec3 triplanarWeights')
    expect(shader.fragmentShader).not.toContain('#include <triplanarDetailFunctions>')
  })

  it('слой по умолчанию выключен (текстуры ещё не привязаны)', () => {
    expect(InstancedAsteroidShaderTemplate.uniforms.uDetailMapsEnabled.value).toBe(0)
  })
})
