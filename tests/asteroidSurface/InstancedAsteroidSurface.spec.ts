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

  it('единый цвет + specular юниформы, процедурное зерно/трещины убраны', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.uniforms.uRockColor).toBeDefined()
    expect(shader.uniforms).not.toHaveProperty('uGrainStrength')
    expect(shader.uniforms).not.toHaveProperty('uCrackIntensity')
    expect(shader.uniforms.uSpecularStrength).toBeDefined()
    expect(shader.fragmentShader).toContain('uSpecularPower')
  })

  it('аналитическая нормаль в объектном пространстве → переход во view + Blinn-Phong', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.fragmentShader).toContain('applyAsteroidSurface(')
    expect(shader.fragmentShader).toContain('vObjToView')     // объект→view переход
    expect(shader.fragmentShader).toContain('vObjectNormal')
    expect(shader.fragmentShader).toContain('halfVec')
    expect(shader.fragmentShader).toContain('ringDustApplyFog(')
    // Конечно-разностный путь нормали убран
    expect(shader.fragmentShader).not.toContain('perturbNormalFromHeight')
  })

  it('процедурные кратеры и fwidth-AA убраны — юниформы отсутствуют', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.uniforms).not.toHaveProperty('uCraterFreq')
    expect(shader.uniforms).not.toHaveProperty('uCraterDensity')
    expect(shader.uniforms).not.toHaveProperty('uCraterRadius')
    expect(shader.uniforms).not.toHaveProperty('uCraterDepth')
    expect(shader.uniforms).not.toHaveProperty('uCraterOctaves')
    expect(shader.uniforms).not.toHaveProperty('uAoStrength')
    expect(shader.uniforms).not.toHaveProperty('uCraterNormalScale')
    expect(shader.uniforms).not.toHaveProperty('uAaStart')
    expect(shader.uniforms).not.toHaveProperty('uAaEnd')
    expect(shader.fragmentShader).not.toContain('fwidth(surfDir)')
    expect(shader.fragmentShader).not.toContain('uDetailFade')
  })
})
