import { describe, expect, it } from 'vitest'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import {
  WATER_RIPPLE_DIRECTIONS,
  waterOctavesFunctions
} from '@/core/materials/shaders/lib/chunks/WaterOctaves'
import {
  WATER_DETAIL_WRAP_METERS,
  WATER_OCTAVE_SLOPE_VARIANCE,
  WATER_RIPPLE_PERIODS_METERS,
  WATER_WAVE_PERIODS_METERS,
  rippleSpeedMps
} from '@/core/materials/shaders/lib/chunks/waterOctavesMath'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'

const chunk = waterOctavesFunctions

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  expect(start, signature).toBeGreaterThan(-1)
  const end = source.indexOf('\n  }', start)
  return source.slice(start, end)
}

describe('WaterOctaves: чанк мелких октав', () => {
  it('зарегистрирован для #include и подключён во фрагментнике воды под USE_WATER_WAVES', () => {
    expect(AppShaderChunk.waterOctavesFunctions).toBe(waterOctavesFunctions)
    const frag = WaterShaderTemplate.fragmentShader
    const include = frag.indexOf('#include <waterOctavesFunctions>')
    const wavesOpen = frag.indexOf('#ifdef USE_WATER_WAVES')
    expect(include).toBeGreaterThan(wavesOpen)
    expect(include).toBeLessThan(frag.indexOf('void main()'))
    // юниформы, которые читает чанк, объявлены раньше подключения
    for (const decl of [
      'uniform sampler2D uWaterNormalMap;',
      'uniform float uTime;',
      'uniform float uWaterWaveSpeed;',
      'uniform float uWaterRippleStrength;'
    ]) {
      const at = frag.indexOf(decl)
      expect(at, decl).toBeGreaterThan(wavesOpen)
      expect(at, decl).toBeLessThan(include)
    }
  })

  it('периоды и константы — из CPU-зеркала, float-литералами', () => {
    WATER_RIPPLE_PERIODS_METERS.forEach((p, i) => {
      expect(chunk).toContain(`#define WATER_RIPPLE_PERIOD_${i} ${p}.0`)
    })
    WATER_WAVE_PERIODS_METERS.forEach((p, i) => {
      expect(chunk).toContain(`#define WATER_WAVE_PERIOD_${i} ${p}.0`)
    })
    expect(chunk).toContain(`#define WATER_OCTAVE_SLOPE_VARIANCE ${WATER_OCTAVE_SLOPE_VARIANCE}`)
    // литералы буквально: целое дало бы int в float-выражении — ошибка компиляции
    expect(chunk).toContain('#define WATER_RIPPLE_PERIOD_0 2560.0')
    expect(chunk).toContain('#define WATER_RIPPLE_PERIOD_4 10.0')
    expect(chunk).toContain('#define WATER_WAVE_PERIOD_3 90000.0')
    expect(chunk).toContain('#define WATER_OCTAVE_SLOPE_VARIANCE 0.06427')
  })

  it('каждый период мелкой октавы делит обёртку домена (иначе шов на границе патчей)', () => {
    for (const p of WATER_RIPPLE_PERIODS_METERS) expect(WATER_DETAIL_WRAP_METERS % p).toBe(0)
  })

  it('скролл октавы: единичное направление · скорость √λ / период, тайлов в секунду', () => {
    expect(WATER_RIPPLE_DIRECTIONS).toHaveLength(WATER_RIPPLE_PERIODS_METERS.length)
    WATER_RIPPLE_PERIODS_METERS.forEach((p, i) => {
      const [dx, dy] = WATER_RIPPLE_DIRECTIONS[i]
      expect(Math.hypot(dx, dy)).toBeCloseTo(1, 12)
      const line = chunk.split('\n').find((l) => l.includes(`#define WATER_RIPPLE_SCROLL_${i} vec2(`))
      expect(line, `scroll ${i}`).toBeDefined()
      const [, sx, sy] = /vec2\(([^,]+), ([^)]+)\)/.exec(line!)!
      const k = rippleSpeedMps(p) / p
      expect(Number(sx)).toBeCloseTo(dx * k, 9)
      expect(Number(sy)).toBeCloseTo(dy * k, 9)
      expect(sx).toMatch(/[.e]/)
      expect(sy).toMatch(/[.e]/)
    })
    // направления чередуются (не все в одну сторону)
    expect(WATER_RIPPLE_DIRECTIONS[0][0]).toBeGreaterThan(0)
    expect(WATER_RIPPLE_DIRECTIONS[1][0]).toBeLessThan(0)
  })

  it('вес октавы — GLSL-двойник octaveWeight; футпринт — двойник footprintMeters', () => {
    expect(chunk).toContain('float waterOctaveWeight(float period, float footprint) {')
    expect(chunk).toContain('smoothstep(2.0 * f, 4.0 * f, period)')
    expect(chunk).toContain('float waterFootprintMeters(float distanceMeters, float pixelAngle, float muV) {')
    expect(chunk).toContain('return distanceMeters * pixelAngle / max(muV, 0.2);')
  })

  it('мелкие октавы — только texture2DGradEXT, ни одной неявной выборки', () => {
    expect(chunk).toContain('texture2DGradEXT(uWaterNormalMap,')
    expect(chunk).not.toContain('texture2D(')
    const body = functionBody(chunk, 'vec3 waterRippleDeviation(')
    expect(body).not.toContain('texture2D(')
  })

  it('сигнатура: тело-локальное отклонение и дисперсия погасших октав', () => {
    expect(chunk).toContain(
      'vec3 waterRippleDeviation(vec3 posM, vec3 dirLocal, float footprint, out float fadedVariance) {'
    )
  })

  it('производные домена каждой октавы посчитаны до первой ветки по весу', () => {
    const body = functionBody(chunk, 'vec3 waterRippleDeviation(')
    const firstBranch = body.indexOf('if (w')
    expect(firstBranch).toBeGreaterThan(-1)
    WATER_RIPPLE_PERIODS_METERS.forEach((_p, i) => {
      const dx = body.indexOf(`vec3 q${i}Dx = dFdx(q${i});`)
      const dy = body.indexOf(`vec3 q${i}Dy = dFdy(q${i});`)
      expect(dx, `dFdx октавы ${i}`).toBeGreaterThan(-1)
      expect(dy, `dFdy октавы ${i}`).toBeGreaterThan(-1)
      expect(dx).toBeLessThan(firstBranch)
      expect(dy).toBeLessThan(firstBranch)
      expect(body).toContain(`if (w${i} > 0.0)`)
    })
    // после ветвления производных больше нет
    expect(body.slice(firstBranch)).not.toMatch(/dFd[xy]|fwidth/)
  })

  it('домен октавы: posM / период, скролл только сдвигом тайла по xy (W-периодичность)', () => {
    const body = functionBody(chunk, 'vec3 waterRippleDeviation(')
    WATER_RIPPLE_PERIODS_METERS.forEach((_p, i) => {
      expect(body).toContain(`vec3 q${i} = posM / WATER_RIPPLE_PERIOD_${i};`)
      expect(body).toContain(`q${i}.xy += WATER_RIPPLE_SCROLL_${i} * t;`)
    })
    expect(body).toContain('float t = uTime * uWaterWaveSpeed;')
  })

  it('трипланар октавы — те же свизлы, веса 1.5/1.0 и axisSign, что у waterWaveNormal', () => {
    expect(chunk).toContain('vec3 fromX = nX.zyx * vec3(1.0, 1.5, 1.5) * vec3(axisSign.x, 1.0, 1.0);')
    expect(chunk).toContain('vec3 fromY = nY.xzy * vec3(1.5, 1.0, 1.5) * vec3(1.0, axisSign.y, 1.0);')
    expect(chunk).toContain('vec3 fromZ = nZ.xyz * vec3(1.5, 1.5, 1.0) * vec3(1.0, 1.0, axisSign.z);')
    expect(chunk).toContain('2.0 * texture2DGradEXT(uWaterNormalMap, q.zy, qDx.zy, qDy.zy).xyz - 1.0')
    expect(chunk).toContain('2.0 * texture2DGradEXT(uWaterNormalMap, q.xz, qDx.xz, qDy.xz).xyz - 1.0')
    expect(chunk).toContain('2.0 * texture2DGradEXT(uWaterNormalMap, q.xy, qDx.xy, qDy.xy).xyz - 1.0')
    expect(chunk).toContain('vec3 axisSign = sign(dirLocal);')
  })

  it('отклонение — тангенциальная часть нормали октавы; сумма w·s·dev; дисперсия Σ(1 − w)·s²·V', () => {
    expect(chunk).toContain('return n - dirLocal * dot(n, dirLocal);')
    const body = functionBody(chunk, 'vec3 waterRippleDeviation(')
    expect(body).toContain('fadedVariance = 0.0;')
    expect(body).toContain('float s2V = uWaterRippleStrength * uWaterRippleStrength * WATER_OCTAVE_SLOPE_VARIANCE;')
    WATER_RIPPLE_PERIODS_METERS.forEach((_p, i) => {
      expect(body).toContain(`float w${i} = waterOctaveWeight(WATER_RIPPLE_PERIOD_${i}, footprint);`)
      expect(body).toContain(`fadedVariance += (1.0 - w${i}) * s2V;`)
    })
    expect(body).toContain('return dev * uWaterRippleStrength;')
  })

  it('в домен не входит ничего непериодичного по W (ни хешей, ни поворотов)', () => {
    expect(chunk).not.toMatch(/hash|fract\(|sin\(|cos\(|mat2/)
  })
})
