import {
  ATMOSPHERE_SLOTS,
  SLOT_PARAM_NAMES,
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

  it('снимает макрос PI из three <common> до объявления const float PI', () => {
    expect(core.indexOf('#undef PI')).toBeGreaterThan(-1)
    expect(core.indexOf('#undef PI')).toBeLessThan(core.indexOf('const float PI'))
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

  it('каждое имя из SLOT_PARAM_NAMES объявлено юниформом слота', () => {
    expect(SLOT_PARAM_NAMES).toHaveLength(17)
    for (const name of SLOT_PARAM_NAMES) {
      expect(slot).toMatch(new RegExp(`uniform \\w+ uSlot1_${name}(\\[5\\])?;`))
    }
  })

  // Клиппинг в GLSL — построчный близнец clipRayToShell (atmosphereDepthMath.ts),
  // который и покрыт числами; расхождение текста = расхождение математики
  it('обрезка луча оболочкой изоморфна clipRayToShell', () => {
    for (const line of [
      'float b = dot(dir, center);',
      'float cc = dot(center, center);',
      'float c = cc - top * top;',
      'if (disc <= 0.0) return;',
      'float tExit = b + root;',
      'if (tExit <= 0.0) return;',
      'bool inside = c < 0.0;',
      'float t0 = inside ? 0.0 : b - root;',
      'if (t0 >= distKm) return;',
      'bool hitSurface = distKm < tExit;',
      'float t1 = hitSurface ? distKm : tExit;',
      'float cBottom = cc - bottom * bottom;',
      'float discBottom = b * b - cBottom;',
      'if (cBottom > 0.0 && discBottom > 0.0) {',
      'float tBottom = b - sqrt(discBottom);',
      'if (tBottom > 0.0 && tBottom < t1) {',
      't1 = tBottom;',
      'hitSurface = true;'
    ]) {
      expect(slot).toContain(line)
    }
  })

  it('дно оболочки берётся из bottom_radius слота', () => {
    expect(slot).toContain('float bottom = uSlot1_bottom_radius;')
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

  it('луч строится по точке вне дальней плоскости: на дальней w обратной проекции гаснет в float32', () => {
    // clip.z = 1 даёт w = (n+far)/(2·far·n) + (n−far)/(2·far·n): при near 1e-6
    // и far 1.5e8 это разность двух чисел порядка 5·10⁵ с ответом ~7·10⁻⁹ —
    // в float32 ровно ноль, деление даёт NaN во всём кадре (замер в браузере)
    expect(frag).toContain('vec4 clip = vec4(uv * 2.0 - 1.0, 0.0, 1.0);')
    expect(frag).not.toContain('vec4 clip = vec4(uv * 2.0 - 1.0, 1.0, 1.0);')
  })

  it('uCount == 0 — копия входа до любых выборок', () => {
    const early = frag.indexOf('if (uCount == 0) { outputColor = inputColor; return; }')
    expect(early).toBeGreaterThan(-1)
    expect(early).toBeLessThan(frag.indexOf('texture2D(depthBuffer'))
  })

  it('точность сэмплера 3D объявлена highp (LUT FloatType)', () => {
    expect(frag).toContain('precision highp sampler3D;')
  })

  it('порядок объявлений: типы ядра → buildLayer → слоты → mainImage', () => {
    const struct = frag.indexOf('struct AtmosphereParameters')
    const layer = frag.indexOf('DensityProfileLayer buildLayer')
    const build0 = frag.indexOf('AtmosphereParameters buildSlot0()')
    const debug = frag.indexOf('uniform float uDebugView;')
    const apply0 = frag.indexOf('void applySlot0(')
    const apply2 = frag.indexOf('void applySlot2(')
    const main = frag.indexOf('void mainImage(')

    expect(struct).toBeGreaterThan(-1)
    expect(struct).toBeLessThan(layer)
    expect(layer).toBeLessThan(build0)
    expect(debug).toBeGreaterThan(-1)
    expect(debug).toBeLessThan(apply0)
    expect(apply2).toBeLessThan(main)
  })

  it('макросы ядра сняты после mainImage, PI возвращён', () => {
    const main = frag.indexOf('void mainImage(')
    expect(frag.indexOf('#undef IN')).toBeGreaterThan(main)
    expect(frag.indexOf('#define PI 3.141592653589793')).toBeGreaterThan(main)
  })
})
