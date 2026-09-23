import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import { Color } from 'three'

const makeVolume = (extra: Partial<{ clumpStrength: number; clumpScale: number }> = {}) =>
  new RingDustVolume({
    innerRadius: 70,
    outerRadius: 140,
    dustScaleHeight: 0.5,
    dustDensity: 0.01,
    dustColor: new Color(0x9b968c),
    anglePower: 2,
    nearFade: 20,
    maxSteps: 16,
    planetRadius: 0,
    ...extra
  })

describe('RingDustClumps', () => {
  it('без clumps текст фрагментного шейдера не меняется (снимок с ветки до фичи), дефайна нет', () => {
    const m = new RingDustRaymarchMaterial()
    expect(m.fragmentShader).toMatchSnapshot()
    expect(m.defines.DUST_CLUMPS).toBeUndefined()
  })

  it('clumps: true — дефайн стоит, в марше есть шум и его подмес до накопления litTau', () => {
    const m = new RingDustRaymarchMaterial(undefined, { clumps: true })
    expect(m.defines.DUST_CLUMPS).toBe('1')
    const fs = m.fragmentShader
    expect(fs).toContain('snoise(')
    expect(fs).toContain('mix(1.0 - uDustClumpStrength, 1.0 + uDustClumpStrength,')
    const mixIdx = fs.indexOf('mix(1.0 - uDustClumpStrength, 1.0 + uDustClumpStrength,')
    const litTauIdx = fs.indexOf('litTau +=')
    expect(mixIdx).toBeGreaterThan(-1)
    expect(mixIdx).toBeLessThan(litTauIdx)
  })

  it('юниформы клочьев всегда присутствуют, нейтральны по умолчанию', () => {
    const u = new RingDustRaymarchMaterial().uniforms
    expect(u.uDustClumpStrength).toBeDefined()
    expect(u.uDustClumpStrength.value).toBe(0)
    expect(u.uDustClumpScale).toBeDefined()
    expect(u.uDustClumpScale.value).toBe(1)
  })

  it('RingDustVolume с clumpStrength/clumpScale включает дефайн и пишет юниформы', () => {
    const volume = makeVolume({ clumpStrength: 0.7, clumpScale: 5 })
    const u = volume.dustMaterial.uniforms
    expect(u.uDustClumpStrength.value).toBe(0.7)
    expect(u.uDustClumpScale.value).toBe(5)
    expect(volume.dustMaterial.defines.DUST_CLUMPS).toBe('1')
  })

  it('RingDustVolume без clumpStrength/clumpScale — нейтральные юниформы, дефайна нет', () => {
    const volume = makeVolume()
    const u = volume.dustMaterial.uniforms
    expect(u.uDustClumpStrength.value).toBe(0)
    expect(u.uDustClumpScale.value).toBe(1)
    expect(volume.dustMaterial.defines.DUST_CLUMPS).toBeUndefined()
  })
})
