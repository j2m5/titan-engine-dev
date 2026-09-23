import { Color } from 'three'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'

// CPU-зеркало ringDustPhaseHG (GLSL в RingDustRaymarchMaterial) — держать в синхроне
function hgPhase(cosTheta: number, g: number): number {
  const g2 = g * g
  return (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * cosTheta, 1e-4), 1.5)
}

const makeVolume = (extra: Partial<{ phaseG: number; phaseStrength: number; colorForward: Color }> = {}) =>
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

describe('RingDustPhase', () => {
  it('без phaseHG дефайна нет, юниформы фазы не влияют на текст программы', () => {
    const m = new RingDustRaymarchMaterial()
    expect(m.defines.DUST_PHASE_HG).toBeUndefined()
    expect(m.fragmentShader).not.toContain('ringDustPhaseHG(')
    expect(m.fragmentShader).not.toContain('uDustColorForward')
  })

  it('phaseHG: true — дефайн стоит, вызов фазы внутри марша до litTau += и есть финальный mix', () => {
    const m = new RingDustRaymarchMaterial(undefined, { phaseHG: true })
    expect(m.defines.DUST_PHASE_HG).toBe('1')
    const fs = m.fragmentShader
    expect(fs).toContain('ringDustPhaseHG(')
    expect(fs).toContain('phaseTau += contrib * ringDustPhaseHG(cosTheta);')
    expect(fs).toContain('vec3 phaseHaze = mix(uDustColor, uDustColorForward, forward) * (phaseMean * RING_DUST_PHASE_BASE);')
    expect(fs).toContain('haze = mix(haze, phaseHaze, uDustPhaseStrength);')

    const contribIdx = fs.indexOf('phaseTau += contrib * ringDustPhaseHG(cosTheta);')
    const litTauIdx = fs.indexOf('litTau +=')
    expect(contribIdx).toBeGreaterThan(-1)
    expect(contribIdx).toBeLessThan(litTauIdx)
  })

  it('клочья применяются к contrib до накопления фазы (порядок сплайсов)', () => {
    const fs = new RingDustRaymarchMaterial(undefined, { clumps: true, phaseHG: true }).fragmentShader
    const clumpIdx = fs.indexOf('contrib *= mix(1.0 - clumpGain, 1.0 + clumpGain,')
    const phaseIdx = fs.indexOf('phaseTau += contrib * ringDustPhaseHG(cosTheta);')
    expect(clumpIdx).toBeGreaterThan(-1)
    expect(phaseIdx).toBeGreaterThan(-1)
    expect(clumpIdx).toBeLessThan(phaseIdx)
  })

  it('оба сочетания с DUST_LIGHT_AT_ORIGIN компилируют разный источник cosTheta', () => {
    const withOrigin = new RingDustRaymarchMaterial(undefined, { lightAtOrigin: true, phaseHG: true }).fragmentShader
    expect(withOrigin).toContain('float cosTheta = dot(rayDir, -p / max(length(p), 1e-6));')

    const withoutOrigin = new RingDustRaymarchMaterial(undefined, { phaseHG: true }).fragmentShader
    expect(withoutOrigin).toContain('float cosTheta = dot(rayDir, uDustLightDirRing);')
  })

  it('юниформы фазы всегда присутствуют, нейтральны по умолчанию', () => {
    const u = new RingDustRaymarchMaterial().uniforms
    expect(u.uDustPhaseG).toBeDefined()
    expect(u.uDustPhaseG.value).toBe(0.55)
    expect(u.uDustPhaseStrength).toBeDefined()
    expect(u.uDustPhaseStrength.value).toBe(0)
    expect(u.uDustColorForward).toBeDefined()
    expect(u.uDustColorForward.value).toBeInstanceOf(Color)
    expect(u.uDustColorForward.value.getHex()).toBe(new Color(0x9b968c).getHex())
  })

  it('CPU-зеркало HG: среднее по сфере равно 1 (интеграл по cosθ ∈ [-1,1] uniform)', () => {
    const samples = 2000
    for (const g of [0.3, 0.55, 0.8]) {
      let sum = 0
      for (let i = 0; i < samples; i++) {
        // uniform cosθ ∈ [-1, 1] — сфера: dΩ = dφ dcosθ, среднее по направлениям = среднее по cosθ
        const cosTheta = -1 + (2 * (i + 0.5)) / samples
        sum += hgPhase(cosTheta, g)
      }
      const mean = sum / samples
      expect(mean).toBeCloseTo(1, 3)
    }
  })

  it('RING_DUST_PHASE_BASE = среднее по сфере прежней дымки 0.75 + 0.45·max(cosθ,0)^4', () => {
    const fs = new RingDustRaymarchMaterial(undefined, { phaseHG: true }).fragmentShader
    const match = /const float RING_DUST_PHASE_BASE = ([0-9.]+);/.exec(fs)
    expect(match).not.toBeNull()
    const base = Number(match?.[1])

    // Лепесток sunTau/ringDustHaze: pow(max(cosθ, 0), 4), uniform cosθ ∈ [-1, 1]
    const samples = 2000
    let sum = 0
    for (let i = 0; i < samples; i++) {
      const cosTheta = -1 + (2 * (i + 0.5)) / samples
      sum += 0.75 + 0.45 * Math.pow(Math.max(cosTheta, 0), 4)
    }
    const mean = sum / samples // аналитически 0.75 + 0.45 · 0.1 = 0.795
    expect(Math.abs(base - mean)).toBeLessThan(1e-2)
    expect(base).toBeCloseTo(0.795, 3)
  })

  it('CPU-зеркало HG: при g = 0.55 вперёд/назад относительно среднего ≈ 7.65 / 0.187', () => {
    const forward = hgPhase(1, 0.55)
    const backward = hgPhase(-1, 0.55)
    expect(forward).toBeCloseTo(7.6543, 3)
    expect(backward).toBeCloseTo(0.1873, 3)
  })

  it('RingDustVolume с phaseStrength > 0 включает дефайн и пишет юниформы (цвет копией)', () => {
    const forwardColor = new Color(0xffcc88)
    const volume = makeVolume({ phaseG: 0.7, phaseStrength: 0.5, colorForward: forwardColor })
    const u = volume.dustMaterial.uniforms
    expect(volume.dustMaterial.defines.DUST_PHASE_HG).toBe('1')
    expect(u.uDustPhaseG.value).toBe(0.7)
    expect(u.uDustPhaseStrength.value).toBe(0.5)
    expect(u.uDustColorForward.value.getHex()).toBe(forwardColor.getHex())
    expect(u.uDustColorForward.value).not.toBe(forwardColor) // копия, не алиас
  })

  it('RingDustVolume без phaseStrength — нейтральные юниформы, дефайна нет, forward = dustColor', () => {
    const dustColor = new Color(0x9b968c)
    const volume = makeVolume({ colorForward: undefined })
    const u = volume.dustMaterial.uniforms
    expect(volume.dustMaterial.defines.DUST_PHASE_HG).toBeUndefined()
    expect(u.uDustPhaseG.value).toBe(0.55)
    expect(u.uDustPhaseStrength.value).toBe(0)
    expect(u.uDustColorForward.value.getHex()).toBe(dustColor.getHex())
  })
})
