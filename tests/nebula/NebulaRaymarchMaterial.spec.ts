import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaRaymarchMaterial', () => {
  it('constructs with uniforms derived from params', () => {
    const mat = new NebulaRaymarchMaterial(mergeNebulaParams({ quality: { maxSteps: 64 } }))
    expect(mat.uniforms.uMaxSteps.value).toBe(64)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(typeof mat.vertexShader).toBe('string')
    expect(mat.fragmentShader.length).toBeGreaterThan(0)
  })

  it('updateMaterial advances uTime without throwing', () => {
    const mat = new NebulaRaymarchMaterial(mergeNebulaParams())
    const before = mat.uniforms.uTime.value
    mat.updateMaterial()
    expect(mat.uniforms.uTime.value).toBeGreaterThanOrEqual(before)
  })

  it('builds independent uniform instances per material (no shared state)', () => {
    const a = new NebulaRaymarchMaterial(mergeNebulaParams({ quality: { maxSteps: 32 } }))
    const b = new NebulaRaymarchMaterial(mergeNebulaParams({ quality: { maxSteps: 128 } }))
    expect(a.uniforms.uMaxSteps).not.toBe(b.uniforms.uMaxSteps)
    expect(a.uniforms.uMaxSteps.value).toBe(32)
    expect(b.uniforms.uMaxSteps.value).toBe(128)
  })
})
