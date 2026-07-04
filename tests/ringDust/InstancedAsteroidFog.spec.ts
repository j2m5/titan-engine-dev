import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { AbstractShader, ShaderProps } from '@/core/materials/shaders/AbstractShader'

// Мини-обёртка: AbstractShader имеет protected-конструктор
class TestShader extends AbstractShader {
  public constructor(props: ShaderProps) {
    super(props)
  }
}

describe('InstancedAsteroidShaderTemplate dust fog (L0)', () => {
  it('exposes dust uniforms in the uniforms record', () => {
    const names = [
      'uDustColor',
      'uDustDensity',
      'uDustScaleHeight',
      'uDustRingInner',
      'uDustRingOuter',
      'uDustCamRingPos',
      'uDustLightDirRing'
    ]
    for (const name of names) {
      expect(InstancedAsteroidShaderTemplate.uniforms[name]).toBeDefined()
    }
    expect(InstancedAsteroidShaderTemplate.uniforms.uDustDensity.value).toBe(0)
  })

  it('passes ring-local position to fragment and applies fog', () => {
    expect(InstancedAsteroidShaderTemplate.vertexShader).toContain('vRingPos')
    expect(InstancedAsteroidShaderTemplate.fragmentShader).toContain('ringDustApplyFog(finalColor, vRingPos)')
  })

  it('resolves ring dust includes through AbstractShader', () => {
    const shader = new TestShader(InstancedAsteroidShaderTemplate)
    expect(shader.fragmentShader).toContain('float ringDustTau')
    expect(shader.fragmentShader).not.toContain('#include <ringDustFunctions>')
  })

  it('несёт v2-uniforms гейта и рампа', () => {
    expect(InstancedAsteroidShaderTemplate.uniforms.uDustAnglePower).toBeDefined()
    expect(InstancedAsteroidShaderTemplate.uniforms.uDustNearFade).toBeDefined()
  })
})
