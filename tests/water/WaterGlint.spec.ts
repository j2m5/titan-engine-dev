import { describe, expect, it } from 'vitest'
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
import { addGlint, dirFromLatLon, glintFromVectors, type Vec3 } from './waterColorMirror'

const frag: string = WaterShaderTemplate.fragmentShader
const chunk = waterOctavesFunctions

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

describe('WaterOctaves: GLSL-двойник waterGlint', () => {
  it('константы блика — из CPU-зеркала, float-литералами', () => {
    expect(chunk).toContain(`#define WATER_GLINT_F0 ${WATER_GLINT_F0}`)
    expect(chunk).toContain('#define WATER_GLINT_F0 0.02')
    expect(chunk).toContain(`#define WATER_GLINT_CEILING ${WATER_GLINT_CEILING}.0`)
    expect(chunk).toContain(`#define WATER_MIN_ALPHA2 ${WATER_MIN_ALPHA2}`)
    expect(chunk).toContain('#define WATER_MIN_ALPHA2 0.0001')
    expect(chunk).toContain(`#define WATER_MAX_ALPHA2 ${WATER_MAX_ALPHA2}.0`)
    expect(chunk).toContain(`#define WATER_TRIPLANAR_SLOPE_GAIN2 ${WATER_TRIPLANAR_SLOPE_GAIN2}`)
    expect(chunk).toContain('#define WATER_TRIPLANAR_SLOPE_GAIN2 2.25')
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

  it('α² = r² + 1.5²·(дисперсия погасших мелких + крупных октав), в [MIN, MAX]', () => {
    expect(frag).toContain('float bigVariance = dot(1.0 - waveWeights, vec4(WATER_OCTAVE_SLOPE_VARIANCE));')
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
    expect(frag).toContain('vec3 glint = waterGlintGlsl(waveNormal, lightDirection, viewDir, alpha2) * waterSunColor;')
    const main = frag.indexOf('void main()')
    const glintDecl = indexAfter(frag, 'vec3 glint = waterGlintGlsl(', main)
    const glintAdd = indexAfter(frag, 'color += min(glint, WATER_GLINT_CEILING) * waveFade * (1.0 - foam);', glintDecl)
    const between = frag.slice(glintDecl, glintAdd)
    expect(between).toMatch(/#ifdef USE_SUN_TINT\s+glint \*= sunTintFactor \* waveDayFactor;\s+#endif/)
    // идентификаторы видны в точке использования
    expect(indexAfter(frag, 'vec3 sunTintFactor =', main)).toBeLessThan(glintDecl)
    expect(indexAfter(frag, 'float waveDayFactor =', main)).toBeLessThan(glintDecl)
    expect(indexAfter(frag, 'vec3 waveNormal =', main)).toBeLessThan(glintDecl)
    expect(indexAfter(frag, 'vec3 lightDirection =', main)).toBeLessThan(glintDecl)
  })

  it('блик после пены, foam объявлена до ветки пены — строка компилируется без USE_WATER_DEPTH', () => {
    const main = frag.indexOf('void main()')
    const blend = indexAfter(frag, 'color = mix(color, wavesColor, waveFade);', main)
    const foamDecl = indexAfter(frag, 'float foam = 0.0;', blend)
    const depthBranch = indexAfter(frag, '#ifdef USE_WATER_DEPTH', foamDecl)
    const foamAssign = indexAfter(frag, 'foam = clamp(shore + surf, 0.0, 1.0);', depthBranch)
    const foamMix = indexAfter(frag, 'color = mix(color, foamLit, foam);', foamAssign)
    const glintAdd = indexAfter(frag, 'color += min(glint, WATER_GLINT_CEILING) * waveFade * (1.0 - foam);', foamMix)
    const depthEnd = indexAfter(frag, '#endif', foamMix)
    expect(glintAdd).toBeGreaterThan(depthEnd) // вне ветки USE_WATER_DEPTH
    expect(glintAdd).toBeLessThan(frag.indexOf('gl_FragColor = vec4(color, alpha);'))
    // одна декларация foam в main — без затенения внутри ветки
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

  it('waveFade = 0 или пена 1 ⇒ цвет ровно без блика; потолок покомпонентно', () => {
    const color: Vec3 = [0.1, 0.2, 0.3]
    const glint: Vec3 = [10, 2, 0]
    expect(addGlint(color, glint, 0, 0)).toEqual(color)
    expect(addGlint(color, glint, 1, 1)).toEqual(color)
    const lit = addGlint(color, glint, 1, 0)
    expect(lit[0]).toBeCloseTo(0.1 + WATER_GLINT_CEILING, 12)
    expect(lit[1]).toBeCloseTo(2.2, 12)
    expect(lit[2]).toBe(0.3)
  })
})
