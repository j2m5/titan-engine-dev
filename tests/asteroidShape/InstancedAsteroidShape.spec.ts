import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'

describe('L0 вершинный шейдер: деформация формы', () => {
  it('объявляет юниформы формы (диапазон амплитуды + частота)', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.vertexShader).toContain('uniform float uShapeAmpMin')
    expect(shader.vertexShader).toContain('uniform float uShapeAmpMax')
    expect(shader.vertexShader).toContain('uniform float uShapeFreq')
    expect(shader.uniforms.uShapeAmpMin).toBeDefined()
    expect(shader.uniforms.uShapeAmpMax).toBeDefined()
    expect(shader.uniforms.uShapeFreq).toBeDefined()
  })

  it('деформирует вершину по сиду из позиции инстанса (после резолва #include)', () => {
    const shader = new InstancedAsteroidShader()
    // #include уже раскрыты конструктором AbstractShader → тела функций на месте
    expect(shader.vertexShader).toContain('hash13(instanceMatrix[3].xyz)')
    expect(shader.vertexShader).toContain('deformAsteroid(')
    expect(shader.vertexShader).toContain('void deformAsteroid(') // чанк реально вклеен
    expect(shader.vertexShader).toContain('vec4 snoiseGrad(vec3 v)') // noiseFunctions вклеен
  })

  it('амплитуда — per-instance из диапазона по декоррелированному хешу', () => {
    const shader = new InstancedAsteroidShader()
    // Второй хеш позиции (декоррелирован от сида рисунка) → mix(min, max)
    expect(shader.vertexShader).toContain('mix(uShapeAmpMin, uShapeAmpMax')
  })
})
