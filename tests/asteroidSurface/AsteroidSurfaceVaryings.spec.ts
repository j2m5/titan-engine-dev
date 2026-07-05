import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'

describe('L0 вершинный шейдер: varyings облика', () => {
  it('объявляет и заполняет vObjectPos и vInstanceSeed', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.vertexShader).toContain('varying vec3 vObjectPos')
    expect(shader.vertexShader).toContain('varying float vInstanceSeed')
    expect(shader.vertexShader).toContain('vObjectPos = shapedPos')
    expect(shader.vertexShader).toContain('vInstanceSeed = shapeSeed')
  })

  it('прокидывает объектную нормаль и матрицу объект→view (для аналитической нормали)', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.vertexShader).toContain('varying vec3 vObjectNormal')
    expect(shader.vertexShader).toContain('varying mat3 vObjToView')
    expect(shader.vertexShader).toContain('vObjectNormal = shapedNormal')
    expect(shader.vertexShader).toContain('vObjToView = normalMatrix * instanceNormalMatrix')
  })
})
