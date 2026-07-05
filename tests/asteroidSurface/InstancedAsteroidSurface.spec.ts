import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'

describe('L0 фрагмент: процедурный облик', () => {
  it('убирает nightMap и day/night-микс', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.fragmentShader).not.toContain('nightMap')
    expect(shader.uniforms).not.toHaveProperty('nightMap')
  })

  it('зовёт процедурный облик и объявляет ключевые юниформы', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.fragmentShader).toContain('applyAsteroidSurface(')
    expect(shader.fragmentShader).toContain('vec3 applyAsteroidSurface(') // чанк вклеен
    expect(shader.fragmentShader).toContain('vec4 worleyCell(') // noiseFunctions вклеен
    expect(shader.uniforms.uCraterDepth).toBeDefined()
    expect(shader.uniforms.uRockColorC).toBeDefined()
  })

  it('сохраняет bumpMap (микрозерно) и пылевую аэроперспективу', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.fragmentShader).toContain('perturbNormalArb')
    expect(shader.fragmentShader).toContain('ringDustApplyFog(')
  })
})
