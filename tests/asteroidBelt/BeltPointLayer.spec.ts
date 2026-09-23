import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { BeltPointLayer } from '@/core/renderables/DetailedRingStreamingSystem/BeltPointLayer'
import { BeltPointsShaderTemplate } from '@/core/materials/shaders/lib/BeltPointsShaderTemplate'
import { BILLBOARD_VERTEX_SHADER } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { buildBeltDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { deriveCascades } from '@/core/renderables/DetailedRingStreamingSystem/cascadeScale'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { AU } from '@/core/constants'
import type { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import { withoutComments } from '../helpers/glsl'

const INNER = 40
const OUTER = 60
const HALF_THICKNESS = 1
const MAX_DISTANCE = 12000

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
    pointScale: 220,
    maxDistance: MAX_DISTANCE,
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

describe('BeltPointLayer: слой всегда видим, кроссфейд — не глобальный множитель', () => {
  it('visible === true сразу после конструктора, без отдельного вызова', () => {
    const layer = new BeltPointLayer(baseParams())
    expect(layer.visible).toBe(true)
  })

  it('глобального uFade/uNearFade в материале нет — кроссфейд считается per-point в шейдере', () => {
    const layer = new BeltPointLayer(baseParams())
    expect(layer.pointMaterial.uniforms.uFade).toBeUndefined()
    expect(layer.pointMaterial.uniforms.uNearFade).toBeUndefined()
  })

  it('setFade у слоя больше нет (метод удалён вместе с глобальным кроссфейдом)', () => {
    const layer = new BeltPointLayer(baseParams())
    expect((layer as unknown as { setFade?: unknown }).setFade).toBeUndefined()
  })

  it('uMaxDistance материала — переданный maxDistance', () => {
    const layer = new BeltPointLayer(baseParams({ maxDistance: 9000 }))
    expect(layer.pointMaterial.uniforms.uMaxDistance.value).toBe(9000)
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

  it('приём размера спрайта — тот же, что у StarfieldShaderTemplate: size * (k / -mvPosition.z); спрайт зажат снизу к пикселю', () => {
    expect(vertex).toMatch(/float trueSize\s*=\s*size\s*\*\s*\(?\s*uPointScale\s*\/\s*[-\w.]+\s*\)?;/)
    expect(vertex).toContain('-mvPosition.z')
    expect(vertex).toContain('gl_PointSize = max(trueSize, 1.0);')
  })

  it('uLightColor объявлен и используется ТОЛЬКО под #ifdef USE_LIGHT_TINT', () => {
    expect(fragment).toContain('#ifdef USE_LIGHT_TINT')
    expect(withoutLightTint(fragment)).not.toContain('uLightColor')
  })

  it('шаблон не тянет текстуру звезды и мерцание (в отличие от StarfieldShaderTemplate)', () => {
    expect(fragment).not.toContain('starTexture')
    expect(vertex + fragment).not.toContain('blink')
  })

  it('глобального uFade/uNearFade юниформа в шаблоне больше нет', () => {
    expect(vertex + fragment).not.toContain('uFade')
    expect(vertex + fragment).not.toContain('uNearFade')
  })
})

describe('BeltPointsShaderTemplate: кроссфейд с L1 — per-point комплемент ИХ ЖЕ формулы', () => {
  const billboardVertex = withoutComments(BILLBOARD_VERTEX_SHADER)
  const pointsVertex = withoutComments(BeltPointsShaderTemplate.vertexShader)

  it('доля near-fade билборда читается из его исходника (не захардкожена в тесте)', () => {
    const match = billboardVertex.match(/smoothstep\(uMaxDistance \* ([\d.]+), uMaxDistance, dist\)/)
    expect(match).not.toBeNull()
  })

  it('точки используют ТУ ЖЕ долю и ТУ ЖЕ пару (uMaxDistance, uMaxDistance) в smoothstep, что и билборд', () => {
    const match = billboardVertex.match(/smoothstep\(uMaxDistance \* ([\d.]+), uMaxDistance, dist\)/)
    const fraction = match![1]
    const escaped = fraction.replace('.', '\\.')
    const expected = new RegExp(`smoothstep\\(uMaxDistance \\* ${escaped}, uMaxDistance, camDist\\)`)

    expect(pointsVertex).toMatch(expected)
  })

  it('метрика — view-space дистанция точки (length(mvPosition.xyz)), как dist = length(mvInstancePos.xyz) у билборда', () => {
    expect(billboardVertex).toContain('length(mvInstancePos.xyz)')
    expect(pointsVertex).toContain('length(mvPosition.xyz)')
  })

  it('fade НЕ инвертирован относительно билборда: точки используют smoothstep напрямую (растёт с дистанцией), билборд — 1 минус он же', () => {
    expect(billboardVertex).toContain('1.0 - smoothstep(uMaxDistance * 0.6, uMaxDistance, dist)')
    expect(pointsVertex).not.toContain('1.0 - smoothstep')
  })
})

describe('AsteroidBelt: точки получают тот же uMaxDistance, что L1-биллборды стримера', () => {
  function beltActor(data: IAsteroidBeltRenderingObject): Actor {
    return {
      renderingObject: { getAttribute: (): unknown => data },
      getAttribute: (key: string, fallback: unknown = ''): unknown => (key === 'categoryId' ? 11 : fallback)
    } as unknown as Actor
  }

  it('uMaxDistance точек = порог билборда крупного каскада (lodThresholdsKm.l1)', () => {
    const data: IAsteroidBeltRenderingObject = {
      innerRadiusAu: 40,
      outerRadiusAu: 60,
      thicknessAu: 0.1,
      sizeRangeKm: [0.5, 60],
      spacingKm: 60,
      dustEnabled: false
    }
    const belt = new AsteroidBelt(beltActor(data))
    const pointLayer = (belt as unknown as { pointLayer: BeltPointLayer }).pointLayer
    const cascades = deriveCascades({
      sizeRangeKm: data.sizeRangeKm,
      spacingKm: data.spacingKm,
      halfThicknessKm: data.thicknessAu * AU * 0.5
    })
    const expected = toThreeJSUnits(cascades[cascades.length - 1].lodThresholdsKm.l1)

    expect(pointLayer.pointMaterial.uniforms.uMaxDistance.value).toBeCloseTo(expected, 6)
  })
})
