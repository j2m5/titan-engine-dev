import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'

describe('BillboardAsteroidMaterial dust fog (L1)', () => {
  it('exposes dust uniforms with fog disabled by default', () => {
    const material = new BillboardAsteroidMaterial()
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
      expect(material.uniforms[name]).toBeDefined()
    }
    expect(material.uniforms.uDustDensity.value).toBe(0)
  })

  it('inlines the dust chunk and applies fog to billboard color', () => {
    const material = new BillboardAsteroidMaterial()
    expect(material.fragmentShader).toContain('float ringDustTau')
    expect(material.fragmentShader).toContain('ringDustApplyFog(color, vRingPos)')
    expect(material.vertexShader).toContain('vRingPos = instancePos')
  })

  it('несёт v2-uniforms гейта и рампа', () => {
    const u = new BillboardAsteroidMaterial().uniforms
    expect(u.uDustAnglePower).toBeDefined()
    expect(u.uDustNearFade).toBeDefined()
  })
})
