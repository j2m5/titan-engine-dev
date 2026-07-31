import { BrunetonAtmosphereShaderTemplate } from '@/core/renderables/Atmosphere/BrunetonAtmosphereShaderTemplate'

describe('Атмосфера: дебаг-виды слагаемых', () => {
  it('uniform uDebugView объявлен и в uniforms, и в шейдере', () => {
    expect(BrunetonAtmosphereShaderTemplate.uniforms.uDebugView).toBeDefined()
    expect(BrunetonAtmosphereShaderTemplate.uniforms.uDebugView.value).toBe(0)
    expect(BrunetonAtmosphereShaderTemplate.fragmentShader).toContain('uniform float uDebugView')
  })

  it('дебаг-ветка отдаёт сырые слагаемые ДО колена (диагностика без искажений)', () => {
    const src = BrunetonAtmosphereShaderTemplate.fragmentShader
    const debugBranch = src.indexOf('uDebugView > 0.5')
    const knee = src.indexOf('excess * uHdrKnee')

    expect(debugBranch).toBeGreaterThan(-1)
    expect(debugBranch).toBeLessThan(knee)
  })

  it('инвариант колена не сломан (кросс-чек с PostprocessingContract)', () => {
    expect(BrunetonAtmosphereShaderTemplate.fragmentShader).toContain('min(color, vec3(1.0)) + excess * uHdrKnee')
  })
})
