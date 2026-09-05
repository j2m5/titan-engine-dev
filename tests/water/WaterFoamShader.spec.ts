import { describe, expect, it } from 'vitest'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'

const frag: string = WaterShaderTemplate.fragmentShader

describe('WaterShaderTemplate: пена прибоя из градиента канала A', () => {
  it('юниформы пены объявлены в шаблоне с инертными дефолтами', () => {
    const u = WaterShaderTemplate.uniforms as Record<string, { value: unknown }>
    expect(u.uFoamStrength.value).toBe(0)
    expect(u.uFoamShoreMeters.value).toBe(1)
    expect(u.uFoamSurfMeters.value).toBe(2)
    expect(u.uFoamWavelengthMeters.value).toBe(1)
    expect(u.uFoamPeriod.value).toBe(1)
    expect(u.uFoamNoiseScale.value).toBe(1)
    expect(u.uFoamRadiusMeters.value).toBe(0)
    expect(u.uSlopeTexelMeters.value).toBe(0)
    expect((u.uSlopeTexel.value as { x: number; y: number }).x).toBe(0)
    for (const name of ['uFoamStrength', 'uFoamShoreMeters', 'uFoamSurfMeters', 'uFoamWavelengthMeters', 'uFoamPeriod', 'uFoamNoiseScale', 'uFoamRadiusMeters', 'uSlopeTexelMeters']) {
      expect(frag).toContain(`uniform float ${name};`)
    }
    expect(frag).toContain('uniform vec3 uFoamColor;')
    expect(frag).toContain('uniform vec2 uSlopeTexel;')
  })

  it('расстояние до уреза: два дополнительных сэмпла канала A и формула спеки', () => {
    expect((frag.match(/texture2D\(uSlopeMap/g) ?? []).length).toBe(3)
    expect(frag).toContain('float aE = texture2D(uSlopeMap, uv + vec2(uSlopeTexel.x, 0.0)).a;')
    expect(frag).toContain('float aN = texture2D(uSlopeMap, uv - vec2(0.0, uSlopeTexel.y)).a;')
    expect(frag).toContain('float gradLen = length(vec2(aE - a0, aN - a0));')
    expect(frag).toContain('float texelMeters = uSlopeTexelMeters * max(sqrt(1.0 - dirLocal.y * dirLocal.y), 0.05);')
    expect(frag).toContain('float dist = a0 * texelMeters / max(gradLen, 1e-4);')
    // смещение уреза: суша клампит канал A в 0, скат начинается на полтекселя раньше берега (спека §1.1)
    expect(frag).toContain('#define FOAM_SHORE_BIAS 0.33333')
    expect(frag).toContain('dist = max(dist - FOAM_SHORE_BIAS * texelMeters, 0.0);')
  })

  it('блок пены — внутри USE_WATER_WAVES, вложенно под USE_WATER_DEPTH, после волн и до gl_FragColor', () => {
    const wavesOpen = frag.indexOf('#ifdef USE_WATER_WAVES', frag.indexOf('void main()'))
    const foamOpen = frag.indexOf('#ifdef USE_WATER_DEPTH', frag.indexOf('float waveFade ='))
    const distLine = frag.indexOf('float dist = a0 * texelMeters')
    const wavesMix = frag.indexOf('color = mix(color, wavesColor, waveFade);')
    const foamMix = frag.indexOf('color = mix(color, uFoamColor, foam);')
    const alphaLine = frag.indexOf('alpha = max(alpha, foam);')
    const out = frag.indexOf('gl_FragColor = vec4(color, alpha);')
    expect(wavesOpen).toBeGreaterThan(-1)
    expect(foamOpen).toBeGreaterThan(wavesOpen)
    expect(distLine).toBeGreaterThan(foamOpen)
    // пена смешивается ПОСЛЕ готового цвета волн: спекуляр под пеной гаснет самим mix
    expect(foamMix).toBeGreaterThan(wavesMix)
    expect(alphaLine).toBeGreaterThan(foamMix)
    expect(out).toBeGreaterThan(alphaLine)
  })

  it('гейты: экранный след до ранних выходов, fade волн множителем, strength множителем', () => {
    const footprint = frag.indexOf('float distFootprint = fwidth(dist);')
    const gate = frag.indexOf('if (foamWeight > 0.0) {', footprint)
    expect(footprint).toBeGreaterThan(-1)
    expect(frag).toContain('float foamWeight = (1.0 - smoothstep(0.5, 1.0, distFootprint / uFoamShoreMeters)) * waveFade;')
    // fwidth(dist) стоит ДО ветвления (однородный поток в кваде)
    expect(gate).toBeGreaterThan(footprint)
    expect(frag).toContain('foam *= uFoamStrength * foamWeight;')
  })

  it('три слоя: кайма с пульсом, накаты с фазой к берегу, рвань шумом волн без нового сэмплера', () => {
    expect(frag).toContain('float t = uTime / uFoamPeriod;')
    expect(frag).toContain('float shore = 1.0 - smoothstep(0.0, uFoamShoreMeters * (1.0 + 0.15 * sin(6.2832 * t)), dist);')
    expect(frag).toContain('float phase = dist / uFoamWavelengthMeters - t;')
    expect(frag).toContain('float crest = pow(1.0 - abs(fract(phase) * 2.0 - 1.0), 6.0);')
    expect(frag).toContain('float noise = foamNoise(dirLocal, uFoamShoreMeters * uFoamNoiseScale, t);')
    expect(frag).toContain('foam *= smoothstep(0.35, 0.75, noise + 0.3 * foam);')
    // шум пены — из той же текстуры нормалей волн, других сэмплеров в шаблоне нет
    expect((frag.match(/uniform sampler2D /g) ?? []).length).toBe(2) // uSlopeMap + uWaterNormalMap
    expect(frag).toContain('float foamNoise(vec3 dirLocal, float periodMeters, float t) {')
  })

  it('без карты глубины / без волн — ни одного символа пены не компилируется (только #ifdef-гейты)', () => {
    // все упоминания uFoam* внутри main лежат после начала USE_WATER_WAVES-блока
    const mainStart = frag.indexOf('void main()')
    const wavesOpen = frag.indexOf('#ifdef USE_WATER_WAVES', mainStart)
    const firstFoamUse = frag.indexOf('uFoam', mainStart)
    expect(firstFoamUse).toBeGreaterThan(wavesOpen)
  })
})
