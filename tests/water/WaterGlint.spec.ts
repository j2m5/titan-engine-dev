import { describe, expect, it } from 'vitest'
import { waterGlintFunctions } from '@/core/materials/shaders/lib/chunks/WaterGlint'
import { waterOctavesFunctions } from '@/core/materials/shaders/lib/chunks/WaterOctaves'
import {
  WATER_GLINT_CEILING,
  WATER_GLINT_F0,
  WATER_MAX_ALPHA2,
  WATER_MIN_ALPHA2,
  WATER_TRIPLANAR_SLOPE_GAIN2,
  waterGlint
} from '@/core/materials/shaders/lib/chunks/waterOctavesMath'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import {
  addGlint,
  blendedColor,
  dirFromLatLon,
  foundationColor,
  glintFromVectors,
  mixWithFoundation,
  wavesColor,
  type BlendInputs,
  type Vec3
} from './waterColorMirror'

const frag: string = WaterShaderTemplate.fragmentShader
const chunk = waterGlintFunctions

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  expect(start, signature).toBeGreaterThan(-1)
  const end = source.indexOf('\n  }', start)
  return source.slice(start, end)
}

function indexAfter(source: string, needle: string, from: number): number {
  const at = source.indexOf(needle, from)
  expect(at, needle).toBeGreaterThan(-1)
  return at
}

describe('WaterGlint: GLSL-двойник waterGlint', () => {
  it('константы блика — из CPU-зеркала, float-литералами', () => {
    expect(chunk).toContain(`#define WATER_GLINT_F0 ${WATER_GLINT_F0}`)
    expect(chunk).toContain('#define WATER_GLINT_F0 0.02')
    expect(chunk).toContain(`#define WATER_GLINT_CEILING ${WATER_GLINT_CEILING}.0`)
    expect(chunk).toContain(`#define WATER_MIN_ALPHA2 ${WATER_MIN_ALPHA2}`)
    expect(chunk).toContain('#define WATER_MIN_ALPHA2 0.0001')
    expect(chunk).toContain(`#define WATER_MAX_ALPHA2 ${WATER_MAX_ALPHA2}.0`)
    expect(waterOctavesFunctions).toContain(`#define WATER_TRIPLANAR_SLOPE_GAIN2 ${WATER_TRIPLANAR_SLOPE_GAIN2}`)
    expect(waterOctavesFunctions).toContain('#define WATER_TRIPLANAR_SLOPE_GAIN2 2.25')
  })

  it('формула — та же, что waterGlint: нормировка (p+8)/(8π), Шлик F0, × N·L, потолок, ноль при N·L ≤ 0', () => {
    const body = functionBody(chunk, 'float waterGlintGlsl(vec3 n, vec3 l, vec3 v, float alpha2) {')
    expect(body).toContain('vec3 hSum = l + v;')
    expect(body).toContain('vec3 h = hSum / max(length(hSum), 1e-6);')
    expect(body).toContain('float nDotL = dot(n, l);')
    expect(body).toContain('if (nDotL <= 0.0) return 0.0;')
    expect(body).toContain('float p = 2.0 / clamp(alpha2, WATER_MIN_ALPHA2, WATER_MAX_ALPHA2) - 2.0;')
    expect(body).toContain('float fresnel = WATER_GLINT_F0 + (1.0 - WATER_GLINT_F0) * pow(1.0 - clamp(dot(v, h), 0.0, 1.0), 5.0);')
    // основание pow > 0: pow(0, 0) в GLSL не определён
    expect(body).toContain('float lobe = (p + 8.0) / (8.0 * WATER_PI) * pow(max(dot(n, h), 1e-8), p);')
    expect(body).toContain('return min(lobe * nDotL * fresnel, WATER_GLINT_CEILING);')
  })
})

describe('WaterShaderTemplate: блик по шероховатости', () => {
  it('солнечного спекуляра Water.js больше нет', () => {
    expect(frag).not.toContain('waterSunColor * waveSpecularLight')
    expect(frag).not.toContain('waveSpecularLight')
    expect(frag).not.toContain('100.0, 2.0, 0.5')
  })

  it('α² = r² + 1.5²·(дисперсия погасших мелких + крупных октав), в [MIN, MAX]; крупная — доля среднего, V/16', () => {
    expect(frag).toContain('float bigVariance = dot(1.0 - waveWeights, vec4(WATER_OCTAVE_SLOPE_VARIANCE / 16.0));')
    expect(frag).toContain(
      'float alpha2 = clamp(uWaterRoughness * uWaterRoughness + WATER_TRIPLANAR_SLOPE_GAIN2 * (rippleVariance + bigVariance), WATER_MIN_ALPHA2, WATER_MAX_ALPHA2);'
    )
    // rippleVariance заполняется waterWaveNormal раньше
    const filled = frag.indexOf('vec3 waveLocalNormal = waterWaveNormal(')
    expect(filled).toBeGreaterThan(-1)
    expect(frag.indexOf('float alpha2 = clamp(')).toBeGreaterThan(filled)
  })

  it('цвет блика: waterSunColor (под USE_LIGHT_TINT это uLightColor), закатный тинт × waveDayFactor', () => {
    expect(frag).toContain('#define waterSunColor uLightColor')
    expect(frag).toContain('vec3 glint = waterGlintGlsl(glintNormal, lightDirection, viewDir, glintAlpha2) * waterSunColor * dayFactor;')
    const main = frag.indexOf('void main()')
    const glintDecl = indexAfter(frag, 'vec3 glint = waterGlintGlsl(', main)
    const glintAdd = indexAfter(frag, 'color += min(glint, WATER_GLINT_CEILING) * uWaterGlintGain * (1.0 - foam);', glintDecl)
    const between = frag.slice(glintDecl, glintAdd)
    expect(between).toMatch(/#ifdef USE_SUN_TINT\s+glint \*= sunTintFactor \* glintDayFactor;\s+#endif/)
    // идентификаторы видны в точке использования
    expect(indexAfter(frag, 'vec3 sunTintFactor =', main)).toBeLessThan(glintDecl)
    expect(indexAfter(frag, 'float waveDayFactor =', main)).toBeLessThan(glintDecl)
    expect(indexAfter(frag, 'vec3 glintNormal = normal;', main)).toBeLessThan(glintDecl)
    expect(indexAfter(frag, 'vec3 lightDirection =', main)).toBeLessThan(glintDecl)
  })

  it('блик гасит геометрический терминатор (dayFactor фундамента) в обоих путях USE_SUN_TINT', () => {
    const main = frag.indexOf('void main()')
    const dayDecl = indexAfter(frag, 'float dayFactor = smoothstep(-0.08, 0.25, NdotL);', main)
    const wavesOpen = indexAfter(frag, '#ifdef USE_WATER_WAVES', main)
    const glintDecl = indexAfter(frag, 'vec3 glint = waterGlintGlsl(', main)
    // объявлен в main() вне любого #ifdef и до блока волн — виден при любой комбинации дефайнов
    expect(dayDecl).toBeLessThan(wavesOpen)
    const beforeDay = frag.slice(main, dayDecl)
    const opens = (beforeDay.match(/#ifdef|#ifndef|#if /g) ?? []).length
    const closes = (beforeDay.match(/#endif/g) ?? []).length
    expect(opens).toBe(closes)
    // множитель — в безусловной строке, не внутри ветки USE_SUN_TINT
    expect(frag.slice(glintDecl, frag.indexOf(';', glintDecl))).toMatch(/\* dayFactor$/)
    const branch = frag.slice(main, glintDecl)
    expect(branch.lastIndexOf('#ifdef USE_SUN_TINT')).toBeLessThan(branch.lastIndexOf('#endif'))
  })

  it('блик после пены и вне веток волн/глубины; foam объявлена один раз до блока волн', () => {
    const main = frag.indexOf('void main()')
    const foamDecl = indexAfter(frag, 'float foam = 0.0;', main)
    const wavesOpen = indexAfter(frag, '#ifdef USE_WATER_WAVES', main)
    expect(foamDecl).toBeLessThan(wavesOpen)
    const foamMix = indexAfter(frag, 'color = mix(color, foamLit, foam);', wavesOpen)
    const glintAdd = indexAfter(frag, 'color += min(glint, WATER_GLINT_CEILING) * uWaterGlintGain * (1.0 - foam);', foamMix)
    const before = frag.slice(main, glintAdd).replace(/\/\/.*$/gm, '') // без комментариев: в них упоминается #ifdef
    expect((before.match(/#endif/g) ?? []).length).toBe((before.match(/#if/g) ?? []).length)
    expect(glintAdd).toBeLessThan(frag.indexOf('gl_FragColor = vec4(color, alpha);'))
    expect(frag.slice(main).match(/float foam\b/g)).toHaveLength(1)
  })
})

describe('CPU-зеркало блика (waterColorMirror.ts)', () => {
  it('glintFromVectors — waterGlint от h = norm(l + v)', () => {
    const n: Vec3 = [0, 1, 0]
    expect(glintFromVectors(n, n, n, 0.01)).toBe(waterGlint(1, 1, 1, 0.01))
    const l = dirFromLatLon(60, 0)
    const v = dirFromLatLon(60, 180)
    expect(glintFromVectors(n, l, v, 0.05)).toBeCloseTo(waterGlint(1, Math.sin(Math.PI / 3), Math.sin(Math.PI / 3), 0.05), 12)
    // l = −v: h вырожден, блик конечен
    expect(Number.isFinite(glintFromVectors(n, [0, 1, 0], [0, -1, 0], 0.05))).toBe(true)
  })

  it('энергия лепестка при нормальном падении слабо зависит от шероховатости (≈ F0)', () => {
    const steps = 4000
    for (const a2 of [0.002, 0.01, 0.05, 0.2]) {
      let energy = 0
      for (let i = 0; i < steps; i++) {
        const th = ((i + 0.5) / steps) * (Math.PI / 2)
        const dOmega = Math.sin(th) * (Math.PI / 2 / steps) * 2 * Math.PI
        const c = Math.cos(th / 2)
        energy += waterGlint(c, c, 1, a2) * Math.cos(th) * dOmega
      }
      expect(energy / WATER_GLINT_F0).toBeGreaterThan(0.95)
      expect(energy / WATER_GLINT_F0).toBeLessThan(1.1)
    }
  })

  it('за геометрическим терминатором блика нет, даже если волновая нормаль смотрит на солнце', () => {
    const normal: Vec3 = [0, 1, 0]
    const norm = (v: Vec3): Vec3 => {
      const l = Math.hypot(v[0], v[1], v[2])
      return [v[0] / l, v[1] / l, v[2] / l]
    }
    // аналитический N·L = −0.1: ниже полосы терминатора (−0.08)
    const lightDir = norm([1, -0.1 / Math.sqrt(1 - 0.01), 0])
    const viewDir = norm([-1, 1, 0])
    // волна наклонена точно в h: лепесток в пике
    const waveNormal = norm([lightDir[0] + viewDir[0], lightDir[1] + viewDir[1], lightDir[2] + viewDir[2]])
    expect(glintFromVectors(waveNormal, lightDir, viewDir, 0.01)).toBeGreaterThan(0.1)
    const inputs: BlendInputs = {
      baseColor: [0.04, 0.24, 0.4],
      fresnelTint: [0.29, 0.54, 0.77],
      reflectionSample: [0.2, 0.3, 0.4],
      skyColor: [0.2, 0.3, 0.4],
      normal,
      waveNormal,
      viewDir,
      lightDir,
      sunColor: [1, 1, 1],
      nightFloor: 0.08,
      alpha2: 0.01
    }
    const noGlint = mixWithFoundation(
      foundationColor(inputs.baseColor, inputs.fresnelTint, normal, viewDir, lightDir, inputs.nightFloor),
      wavesColor(inputs.baseColor, inputs.reflectionSample, inputs.skyColor, waveNormal, viewDir, lightDir, inputs.sunColor, inputs.nightFloor),
      1
    )
    expect(blendedColor(inputs, 1)).toEqual(noGlint)
    // днём тот же лепесток виден
    const day = { ...inputs, normal: norm([0.3, 1, 0]) }
    expect(blendedColor(day, 1)[0]).toBeGreaterThan(
      mixWithFoundation(
        foundationColor(day.baseColor, day.fresnelTint, day.normal, viewDir, lightDir, day.nightFloor),
        wavesColor(day.baseColor, day.reflectionSample, day.skyColor, waveNormal, viewDir, lightDir, day.sunColor, day.nightFloor),
        1
      )[0]
    )
  })

  it('пена 1 ⇒ без блика; gain множит; потолок покомпонентно', () => {
    const color: Vec3 = [0.1, 0.2, 0.3]
    const glint: Vec3 = [10, 2, 0]
    expect(addGlint(color, glint, 1)).toEqual(color)
    const lit = addGlint(color, glint, 0)
    expect(lit[0]).toBeCloseTo(0.1 + WATER_GLINT_CEILING, 12)
    expect(lit[1]).toBeCloseTo(2.2, 12)
    expect(lit[2]).toBe(0.3)
    expect(addGlint(color, glint, 0, 2)[1]).toBeCloseTo(0.2 + 4, 12)
  })
})
