import {
  ATMOSPHERE_SLOTS,
  buildAtmosphereCoreGlsl,
  buildAtmosphereEffectFragment,
  buildSlotGlsl,
  slotUniformName
} from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'

describe('ядро Брунетона без глобальных обёрток', () => {
  const core = buildAtmosphereCoreGlsl()

  it('обрезано до RADIANCE_API: глобальных сэмплеров и обёрток с ATMOSPHERE нет', () => {
    expect(core).not.toContain('#define RADIANCE_API_ENABLED')
    expect(core).not.toContain('uniform sampler2D transmittance_texture')
    expect(core).not.toMatch(/\bATMOSPHERE\b/)
  })

  it('параметризованные функции ядра на месте', () => {
    expect(core).toContain('RadianceSpectrum GetSkyRadiance(\n      IN(AtmosphereParameters) atmosphere,')
    expect(core).toContain('RadianceSpectrum GetSkyRadianceToPoint(\n      IN(AtmosphereParameters) atmosphere,')
    expect(core).toContain('#define COMBINED_SCATTERING_TEXTURES')
  })
})

describe('слот', () => {
  const slot = buildSlotGlsl(1)

  it('объявляет 17 параметров и три сэмплера с префиксом uSlot1_', () => {
    expect(slot).toContain('uniform vec3 uSlot1_solar_irradiance;')
    expect(slot).toContain('uniform float uSlot1_rayleigh_layer0[5];')
    expect(slot).toContain('uniform float uSlot1_mu_s_min;')
    expect(slot).toContain('uniform sampler2D uSlot1_transmittance;')
    expect(slot).toContain('uniform sampler3D uSlot1_scattering;')
    expect(slot).toContain('uniform sampler2D uSlot1_irradiance;')
    expect(slot).toContain('uniform vec3 uSlot1_center;')
    expect(slot).toContain('uniform vec3 uSlot1_sunDir;')
    expect(slot).toContain('uniform vec2 uSlot1_sunSize;')
    expect(slot).toContain('uniform float uSlot1_exposure;')
    expect(slot).toContain('uniform float uSlot1_hdrKnee;')
  })

  it('builder собирает AtmosphereParameters из юниформов слота', () => {
    expect(slot).toContain('AtmosphereParameters buildSlot1()')
    expect(slot).toContain('uSlot1_rayleigh_scattering,')
  })

  it('applySlot зовёт ядро с сэмплерами слота; single_mie = scattering (COMBINED)', () => {
    expect(slot).toContain('void applySlot1(vec3 dir, float distKm, inout vec3 color)')
    expect(slot).toContain('GetSkyRadianceToPoint(atm, uSlot1_transmittance, uSlot1_scattering, uSlot1_scattering,')
    expect(slot).toContain('GetSkyRadiance(atm, uSlot1_transmittance, uSlot1_scattering, uSlot1_scattering,')
  })

  it('диск солнца — только под небом (внутри ветки !hitSurface)', () => {
    const sky = slot.indexOf('} else {')
    const disc = slot.indexOf('GetSolarRadianceFor(atm)')
    expect(disc).toBeGreaterThan(sky)
    expect(slot.indexOf('hitSurface')).toBeLessThan(disc)
  })

  it('имя юниформа строится одной функцией', () => {
    expect(slotUniformName(2, 'top_radius')).toBe('uSlot2_top_radius')
  })
})

describe('фрагмент эффекта', () => {
  const frag = buildAtmosphereEffectFragment()

  it('K слотов развёрнуты и гейтятся uCount', () => {
    expect(ATMOSPHERE_SLOTS).toBe(3)
    for (let i = 0; i < ATMOSPHERE_SLOTS; i++) {
      expect(frag).toContain(`if (uCount > ${i}) applySlot${i}(dirWorld, distKm, color);`)
    }
  })

  it('свой декод лог-глубины, без readDepth/getViewZ postprocessing', () => {
    expect(frag).toContain('texture2D(depthBuffer, uv).r')
    expect(frag).toContain('exp2(z * uLogFarFactor) - 1.0')
    expect(frag).not.toContain('readDepth(')
    expect(frag).not.toContain('getViewZ(')
  })

  it('uCount == 0 — копия входа до любых выборок', () => {
    const early = frag.indexOf('if (uCount == 0) { outputColor = inputColor; return; }')
    expect(early).toBeGreaterThan(-1)
    expect(early).toBeLessThan(frag.indexOf('texture2D(depthBuffer'))
  })

  it('точность сэмплера 3D объявлена highp (LUT FloatType)', () => {
    expect(frag).toContain('precision highp sampler3D;')
  })
})
