import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { BeltPointLayer } from '@/core/renderables/DetailedRingStreamingSystem/BeltPointLayer'
import { BeltPointsShaderTemplate } from '@/core/materials/shaders/lib/BeltPointsShaderTemplate'
import { buildBeltDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'
import { pointLayerFade, streamerL1Fade } from '@/core/renderables/DetailedRingStreamingSystem/beltCrossFade'
import { withoutComments } from '../helpers/glsl'

const INNER = 40
const OUTER = 60
const HALF_THICKNESS = 1

const FLAT_PROFILE = buildBeltDensityProfile({ edgeSoftness: 0, gaps: [], clumps: [] })

function baseParams(overrides: Partial<ConstructorParameters<typeof BeltPointLayer>[0]> = {}) {
  return {
    innerR: INNER,
    outerR: OUTER,
    halfThickness: HALF_THICKNESS,
    count: 500,
    seed: 7,
    profile: FLAT_PROFILE,
    color: new Color(0x6b6157),
    lightTint: { active: false, color: new Color(1, 1, 1) },
    ...overrides
  }
}

function positionsOf(layer: BeltPointLayer): Float32Array {
  return layer.geometry.getAttribute('position').array as Float32Array
}

/** Снимает всё, что стоит под #ifdef USE_LIGHT_TINT … #endif (без вложенности) */
function withoutLightTint(source: string): string {
  return source.replace(/#ifdef USE_LIGHT_TINT[\s\S]*?#endif/g, '')
}

describe('BeltPointLayer: число точек и охват тора', () => {
  it('число точек в буфере равно count', () => {
    const layer = new BeltPointLayer(baseParams({ count: 321 }))
    expect(layer.geometry.getAttribute('position').count).toBe(321)
  })

  it('все точки внутри тора: inner <= r <= outer, |y| <= halfThickness', () => {
    const layer = new BeltPointLayer(baseParams({ count: 2000 }))
    const positions = positionsOf(layer)

    for (let i = 0; i < 2000; i++) {
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const z = positions[i * 3 + 2]
      const r = Math.hypot(x, z)

      expect(r).toBeGreaterThanOrEqual(INNER - 1e-6)
      expect(r).toBeLessThanOrEqual(OUTER + 1e-6)
      expect(Math.abs(y)).toBeLessThanOrEqual(HALF_THICKNESS + 1e-6)
    }
  })
})

describe('BeltPointLayer: распределение по радиусу следует профилю плотности', () => {
  it('в щели depth 0.85 доля точек <= 25% от равномерной', () => {
    const gapAt = 0.5
    const gapWidth = 0.02
    const gapDepth = 0.85
    const profile = buildBeltDensityProfile({
      edgeSoftness: 0,
      gaps: [{ at: gapAt, width: gapWidth, depth: gapDepth }],
      clumps: []
    })

    const count = 60000
    const layer = new BeltPointLayer(baseParams({ profile, count, seed: 11 }))
    const positions = positionsOf(layer)

    // Узкое окно у самого центра щели (0.1 сигмы) — там гауссиана почти не
    // спадает, и провал в радиальном профиле близок к полному depth = 0.85
    const width = OUTER - INNER
    const halfWindow = 0.1 * gapWidth
    const rGapLo = INNER + (gapAt - halfWindow) * width
    const rGapHi = INNER + (gapAt + halfWindow) * width

    let inGap = 0
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3]
      const z = positions[i * 3 + 2]
      const r = Math.hypot(x, z)
      if (r >= rGapLo && r <= rGapHi) inGap++
    }

    const gapArea = rGapHi * rGapHi - rGapLo * rGapLo
    const totalArea = OUTER * OUTER - INNER * INNER
    const expectedUniform = count * (gapArea / totalArea)

    expect(inGap / expectedUniform).toBeLessThanOrEqual(0.25)
  })
})

describe('BeltPointLayer: детерминизм по сиду', () => {
  it('один и тот же seed — побитово одинаковые позиции', () => {
    const a = new BeltPointLayer(baseParams({ seed: 42, count: 300 }))
    const b = new BeltPointLayer(baseParams({ seed: 42, count: 300 }))

    expect(positionsOf(a)).toEqual(positionsOf(b))
  })

  it('разный seed — разные позиции', () => {
    const a = new BeltPointLayer(baseParams({ seed: 1, count: 300 }))
    const b = new BeltPointLayer(baseParams({ seed: 2, count: 300 }))

    expect(positionsOf(a)).not.toEqual(positionsOf(b))
  })
})

describe('BeltPointLayer: setFade', () => {
  it('setFade(0) прячет слой (visible === false)', () => {
    const layer = new BeltPointLayer(baseParams())
    layer.setFade(0)
    expect(layer.visible).toBe(false)
  })

  it('setFade(> 0) показывает слой и пишет юниформ uFade', () => {
    const layer = new BeltPointLayer(baseParams())
    layer.setFade(0)
    layer.setFade(0.6)
    expect(layer.visible).toBe(true)
    expect(layer.pointMaterial.uniforms.uFade.value).toBe(0.6)
  })
})

describe('BeltPointLayer: гейт USE_LIGHT_TINT', () => {
  it('без подписки светила — дефайна нет', () => {
    const layer = new BeltPointLayer(baseParams({ lightTint: { active: false, color: new Color(1, 1, 1) } }))
    expect(layer.pointMaterial.defines?.USE_LIGHT_TINT).toBeUndefined()
  })

  it('с подпиской светила — дефайн есть, uLightColor подкрашен', () => {
    const tint = new Color(1, 0.6, 0.4)
    const layer = new BeltPointLayer(baseParams({ lightTint: { active: true, color: tint } }))
    expect(layer.pointMaterial.defines?.USE_LIGHT_TINT).toBe('1')
    expect((layer.pointMaterial.uniforms.uLightColor.value as Color).equals(tint)).toBe(true)
  })
})

describe('BeltPointsShaderTemplate: пины шейдера', () => {
  const vertex = withoutComments(BeltPointsShaderTemplate.vertexShader)
  const fragment = withoutComments(BeltPointsShaderTemplate.fragmentShader)

  it('gl_Position собирается через modelViewMatrix, не через модельную/видовую по отдельности', () => {
    expect(vertex).toContain('modelViewMatrix')
    expect(vertex).not.toContain('gl_Position = projectionMatrix * viewMatrix')
  })

  it('приём размера спрайта — тот же, что у StarfieldShaderTemplate: size * (k / -mvPosition.z)', () => {
    expect(vertex).toMatch(/gl_PointSize\s*=\s*size\s*\*\s*\(?\s*uPointScale\s*\/\s*[\w.]+\s*\)?;/)
    expect(vertex).toContain('-mvPosition.z')
  })

  it('uLightColor объявлен и используется ТОЛЬКО под #ifdef USE_LIGHT_TINT', () => {
    expect(fragment).toContain('#ifdef USE_LIGHT_TINT')
    expect(withoutLightTint(fragment)).not.toContain('uLightColor')
  })

  it('шаблон не тянет текстуру звезды и мерцание (в отличие от StarfieldShaderTemplate)', () => {
    expect(fragment).not.toContain('starTexture')
    expect(vertex + fragment).not.toContain('blink')
  })
})

describe('beltCrossFade: точки и L1 гаснут навстречу друг другу', () => {
  const nearThreshold = 12000

  it('сумма fade точек и «противоположного» L1 тождественно 1 при любой дистанции', () => {
    for (const distance of [0, 1000, 6000, 12000, 18000, 24000, 100000]) {
      const sum = pointLayerFade(distance, nearThreshold) + streamerL1Fade(distance, nearThreshold)
      expect(sum).toBeCloseTo(1, 10)
    }
  })

  it('у самого тора (distance = 0) точки погашены, L1 — на максимуме', () => {
    expect(pointLayerFade(0, nearThreshold)).toBe(0)
    expect(streamerL1Fade(0, nearThreshold)).toBe(1)
  })

  it('далеко за порогом (1.5·near и дальше) точки на максимуме', () => {
    expect(pointLayerFade(nearThreshold * 1.5, nearThreshold)).toBe(1)
    expect(pointLayerFade(nearThreshold * 3, nearThreshold)).toBe(1)
  })

  it('монотонность: fade точек растёт с дистанцией', () => {
    let prev = -Infinity
    for (const distance of [0, 2000, 6000, 9000, 12000, 15000, 18000]) {
      const fade = pointLayerFade(distance, nearThreshold)
      expect(fade).toBeGreaterThanOrEqual(prev)
      prev = fade
    }
  })
})
