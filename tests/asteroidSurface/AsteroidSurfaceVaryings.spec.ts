import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'

describe('L0 вершинный шейдер: varyings облика', () => {
  it('объявляет и заполняет vObjectPos; пер-инстансные хеши считаются в вершиннике', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.vertexShader).toContain('varying vec3 vObjectPos')
    expect(shader.vertexShader).toContain('vObjectPos = shapedPos')
    // Анти-ULP-джиттер: во фрагмент едут ГОТОВЫЕ хеши (tintSeed/domainOffset/
    // triOffset), а не сырой сид — интерполяционный шум varying'а не должен
    // проходить через хеш-усиление (fract(sin·47453) ≈ ×4e6)
    expect(shader.vertexShader).toContain('varying float vTintSeed')
    expect(shader.vertexShader).toContain('varying vec3 vDomainOffset')
    expect(shader.vertexShader).toContain('varying vec2 vTriOffset')
    expect(shader.vertexShader).toContain('vTintSeed = hashSurface11(shapeSeed + 3.17)')
    expect(shader.vertexShader).not.toContain('vInstanceSeed')
    expect(shader.fragmentShader).not.toContain('vInstanceSeed')
    // Хеш от интерполированных значений во фрагментнике запрещён: единственное
    // вхождение — ОПРЕДЕЛЕНИЕ в noiseFunctions (общий чанк), вызовов нет
    const fragmentHashMentions = (shader.fragmentShader.match(/hashSurface11\(/g) ?? []).length
    expect(fragmentHashMentions).toBe(1)
  })

  it('прокидывает объектную нормаль и матрицу объект→view (для аналитической нормали)', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.vertexShader).toContain('varying vec3 vObjectNormal')
    expect(shader.vertexShader).toContain('varying mat3 vObjToView')
    expect(shader.vertexShader).toContain('vObjectNormal = shapedNormal')
    expect(shader.vertexShader).toContain('vObjToView = normalMatrix * instanceNormalMatrix')
  })
})
