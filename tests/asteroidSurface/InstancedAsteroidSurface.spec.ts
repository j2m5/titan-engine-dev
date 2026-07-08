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
    expect(shader.uniforms.uGrainStrength).toBeUndefined()
    expect(shader.uniforms.uCrackIntensity).toBeUndefined()
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

  it('fwidth-AA добивает подпиксельный остаток; дальность детали — ручка uAaStart/uAaEnd', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.fragmentShader).toContain('fwidth(surfDir)')
    expect(shader.fragmentShader).toContain('smoothstep(uAaStart, uAaEnd')
    expect(shader.uniforms.uAaStart).toBeDefined()
    expect(shader.uniforms.uAaEnd).toBeDefined()
    expect(shader.fragmentShader).not.toContain('uDetailFade')
  })
})
