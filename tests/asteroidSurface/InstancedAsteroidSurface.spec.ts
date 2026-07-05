import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'

describe('L0 фрагмент: профили (v2)', () => {
  it('убирает бамп-мапу полностью', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.fragmentShader).not.toContain('bumpMap')
    expect(shader.uniforms).not.toHaveProperty('bumpMap')
    expect(shader.uniforms).not.toHaveProperty('uRockColorC')
  })

  it('единый цвет + зерно + specular юниформы', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.uniforms.uRockColor).toBeDefined()
    expect(shader.uniforms.uGrainStrength).toBeDefined()
    expect(shader.uniforms.uSpecularStrength).toBeDefined()
    expect(shader.fragmentShader).toContain('uSpecularPower')
  })

  it('один проход нормали через perturbNormalFromHeight + Blinn-Phong блик', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.fragmentShader).toContain('perturbNormalFromHeight(')
    expect(shader.fragmentShader).toContain('vec3 perturbNormalFromHeight(') // чанк вклеен
    expect(shader.fragmentShader).toContain('halfVec')
    expect(shader.fragmentShader).toContain('ringDustApplyFog(')
  })
})
