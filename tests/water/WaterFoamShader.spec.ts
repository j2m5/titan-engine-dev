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
    expect(u.uFoamRadiusMeters.value).toBe(1)
    expect((u.uSlopeTexelMeters.value as { x: number; y: number }).x).toBe(0)
    expect((u.uSlopeTexelMeters.value as { x: number; y: number }).y).toBe(0)
    expect((u.uSlopeTexel.value as { x: number; y: number }).x).toBe(0)
    expect((u.uSlopeTexel.value as { x: number; y: number }).y).toBe(0)
    for (const name of ['uFoamStrength', 'uFoamShoreMeters', 'uFoamSurfMeters', 'uFoamWavelengthMeters', 'uFoamPeriod', 'uFoamNoiseScale', 'uFoamRadiusMeters']) {
      expect(frag).toContain(`uniform float ${name};`)
    }
    expect(frag).toContain('uniform vec3 uFoamColor;')
    expect(frag).toContain('uniform vec2 uSlopeTexel;')
    expect(frag).toContain('uniform vec2 uSlopeTexelMeters;')
  })

  it('расстояние до уреза: два дополнительных сэмпла канала A и формула спеки (метрика по u/v текселям раздельно)', () => {
    expect((frag.match(/texture2D\(uSlopeMap/g) ?? []).length).toBe(3)
    expect(frag).toContain('float aE = texture2D(uSlopeMap, uv + vec2(uSlopeTexel.x, 0.0)).a;')
    // aS — юг (terrainUv растёт на север, uv - vec2(0, texel.y) шагает на юг)
    expect(frag).toContain('float aS = texture2D(uSlopeMap, uv - vec2(0.0, uSlopeTexel.y)).a; // юг = −v; нужна только длина')
    expect(frag).toContain('float cosLat = max(sqrt(max(1.0 - dirLocal.y * dirLocal.y, 0.0)), 0.05);')
    expect(frag).toContain('vec2 texelM = vec2(uSlopeTexelMeters.x * cosLat, uSlopeTexelMeters.y);')
    expect(frag).toContain('vec2 gradM = vec2(aE - a0, aS - a0) / texelM;                 // прирост A на метр')
    expect(frag).toContain('float gradLen = max(length(gradM), 1e-4 / uSlopeTexelMeters.y); // пол: 1e-4 на тексель, как раньше')
    expect(frag).toContain('float dist = a0 / gradLen;')
    expect(frag).toContain('float texelAlong = gradLen / max(length(gradM / texelM), 1e-12);')
    // смещение уреза: суша клампит канал A в 0, скат начинается на полтекселя раньше берега (спека §1.1)
    expect(frag).toContain('#define FOAM_SHORE_BIAS 0.3333333')
    expect(frag).toContain('dist = max(dist - FOAM_SHORE_BIAS * texelAlong, 0.0);')
  })

  it('блок пены — внутри USE_WATER_WAVES, вложенно под USE_WATER_DEPTH, после волн и до gl_FragColor', () => {
    const wavesOpen = frag.indexOf('#ifdef USE_WATER_WAVES', frag.indexOf('void main()'))
    const foamOpen = frag.indexOf('#ifdef USE_WATER_DEPTH', frag.indexOf('float waveFade ='))
    const distLine = frag.indexOf('float dist = a0 / gradLen;')
    const wavesMix = frag.indexOf('color = mix(color, wavesColor, waveFade);')
    const foamMix = frag.indexOf('color = mix(color, foamLit, foam);')
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

  it('гейт юниформный: перед первой выборкой, охватывает весь блок пены целиком (однородный поток)', () => {
    const gate = frag.indexOf('if (uFoamStrength > 0.0 && uSlopeTexelMeters.y > 0.0) {')
    const aE = frag.indexOf('float aE =')
    const footprint = frag.indexOf('float distFootprint = fwidth(dist);')
    expect(gate).toBeGreaterThan(-1)
    // гейт стоит ДО первой выборки градиента — fwidth и все сэмплы внутри него, поток однородный
    expect(gate).toBeLessThan(aE)
    expect(footprint).toBeGreaterThan(aE)
    expect(frag).toContain('float foamWeight = (1.0 - smoothstep(0.5, 1.0, distFootprint / uFoamShoreMeters)) * waveFade;')
    expect(frag).not.toContain('step(1e-6, uSlopeTexelMeters)')
    expect(frag).toContain('foam *= uFoamStrength * foamWeight;')
  })

  it('три слоя: кайма с пульсом, накаты с фазой к берегу (гребни бегут к берегу), рвань шумом волн без нового сэмплера', () => {
    expect(frag).toContain('float t = uTime / uFoamPeriod;')
    expect(frag).toContain('float shore = 1.0 - smoothstep(0.0, uFoamShoreMeters * (1.0 + 0.15 * sin(6.2832 * t)), dist);')
    expect(frag).toContain('float phase = dist / uFoamWavelengthMeters + t;')
    expect(frag).toContain('float crest = pow(1.0 - abs(fract(phase) * 2.0 - 1.0), 6.0);')
    expect(frag).toContain('float noise = foamNoise(dirLocal, uFoamShoreMeters * uFoamNoiseScale, t);')
    expect(frag).toContain('noise = clamp((noise - 0.5) * FOAM_NOISE_CONTRAST + 0.5, 0.0, 1.0); // канал .x нормалей узкий вокруг 0.5')
    expect(frag).toContain('foam *= smoothstep(0.35, 0.75, noise + 0.3 * foam);')
    expect(frag).toContain('#define FOAM_NOISE_CONTRAST 3.0')
    // шум пены — из той же текстуры нормалей волн, других сэмплеров в шаблоне нет
    expect((frag.match(/uniform sampler2D /g) ?? []).length).toBe(2) // uSlopeMap + uWaterNormalMap
    expect(frag).toContain('float foamNoise(vec3 dirLocal, float periodMeters, float t) {')
  })

  it('пена освещена так же, как wavesColor — не сырой цвет поверх ночной тьмы', () => {
    const sunTintBlock = frag.match(/#ifdef USE_SUN_TINT\s*\n\s*vec3 foamLit = uFoamColor \* mix\(vec3\(uWaterNightFloor\), sunTintFactor, waveDayFactor\);\s*\n\s*#else\s*\n\s*vec3 foamLit = uFoamColor \* mix\(uWaterNightFloor, 1\.0, waveDayFactor\);\s*\n\s*#endif/)
    expect(sunTintBlock).not.toBeNull()
    expect(frag).toContain('color = mix(color, foamLit, foam);')
  })

  it('без карты глубины / без волн — ни одного символа пены не компилируется (только #ifdef-гейты)', () => {
    // ВСЕ упоминания uFoam внутри main лежат между открытием USE_WATER_WAVES
    // и финальной сборкой цвета (граница блока — сама точка выхода #endif)
    const mainStart = frag.indexOf('void main()')
    const wavesOpen = frag.indexOf('#ifdef USE_WATER_WAVES', mainStart)
    const fragColorLine = frag.indexOf('gl_FragColor = vec4(color, alpha);', mainStart)
    expect(wavesOpen).toBeGreaterThan(-1)
    expect(fragColorLine).toBeGreaterThan(wavesOpen)

    let index = frag.indexOf('uFoam', mainStart)
    let count = 0
    while (index !== -1 && index < fragColorLine) {
      expect(index).toBeGreaterThan(wavesOpen)
      count++
      index = frag.indexOf('uFoam', index + 1)
    }
    // ни одного упоминания uFoam после сборки итогового цвета (за пределами блока волн)
    expect(frag.indexOf('uFoam', fragColorLine)).toBe(-1)
    expect(count).toBeGreaterThan(0)
  })
})
