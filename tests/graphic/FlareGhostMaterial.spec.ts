import { describe, expect, it } from 'vitest'
import { AddEquation, CustomBlending, OneFactor, Texture, Uniform, Vector2 } from 'three'
import { FlareGhostMaterial } from '@/core/graphic/effects/lensflare/FlareGhostMaterial'
import { createSpriteQuad } from '@/core/graphic/effects/lensflare/flareSprites'
import { glslFloat } from '@/core/graphic/effects/lensflare/glslLiteral'
import { FLARE_GHOSTS, ghostEnergy, lumaNormalized, profileExtent, profilePeak } from '@/core/graphic/effects/lensflare/flareGhosts'

function floatArray(source: string, name: string): number[] {
  const match = source.match(new RegExp(`const float ${name}\\[\\d+\\] = float\\[\\d+\\]\\(([^)]*)\\);`))
  if (!match) throw new Error(`массив ${name} не найден`)
  return match[1].split(',').map(Number)
}

function vec3Array(source: string, name: string): number[][] {
  const match = source.match(new RegExp(`const vec3 ${name}\\[\\d+\\] = vec3\\[\\d+\\]\\((.*)\\);`))
  if (!match) throw new Error(`массив ${name} не найден`)
  return [...match[1].matchAll(/vec3\(([^)]*)\)/g)].map((m) => m[1].split(',').map(Number))
}

const shared = { ghostAmount: new Uniform(1), intensity: new Uniform(0.1) }
const material = new FlareGhostMaterial(shared, new Texture(), new Texture())
const vert = material.vertexShader
const frag = material.fragmentShader

describe('glslFloat', () => {
  it('целое получает точку, малое — без мусора округления', () => {
    expect(glslFloat(10)).toBe('10.0')
    expect(glslFloat(-0.4)).toBe('-0.4')
    expect(glslFloat(Math.cos(Math.PI / 2))).toBe('0.0')
    expect(glslFloat(1e-7)).toBe('1e-7')
  })

  it('не конечное число — RangeError, а не битый GLSL', () => {
    expect(() => glslFloat(NaN)).toThrow(RangeError)
    expect(() => glslFloat(Infinity)).toThrow(RangeError)
    expect(() => glslFloat(-Infinity)).toThrow(RangeError)
  })
})

describe('createSpriteQuad', () => {
  it('квад [-1, 1]², шесть индексов, инстансов ноль до ресайза', () => {
    const quad = createSpriteQuad()

    expect(quad.isInstancedBufferGeometry).toBe(true)
    expect(quad.getAttribute('position').count).toBe(4)
    expect(quad.getIndex()?.count).toBe(6)
    expect(quad.instanceCount).toBe(0)
  })
})

describe('FlareGhostMaterial: таблица в шейдере — из TS', () => {
  it('положения, радиусы, пики и границы', () => {
    expect(floatArray(vert, 'GHOST_M')).toEqual(FLARE_GHOSTS.map((g) => Number(glslFloat(g.m))))
    expect(floatArray(vert, 'GHOST_RADIUS')).toEqual(FLARE_GHOSTS.map((g) => Number(glslFloat(g.radius))))
    expect(floatArray(vert, 'GHOST_PEAK')).toEqual(FLARE_GHOSTS.map((g) => Number(glslFloat(profilePeak(g.profile)))))
    expect(floatArray(vert, 'GHOST_EXTENT')).toEqual(FLARE_GHOSTS.map((g) => Number(glslFloat(profileExtent(g.profile)))))
    expect(floatArray(vert, 'GHOST_RING')).toEqual(FLARE_GHOSTS.map((g) => (g.profile === 'ring' ? 1 : 0)))
  })

  it('цвет запечён: нормированный оттенок × энергия призрака', () => {
    const colors = vec3Array(vert, 'GHOST_COLOR')
    FLARE_GHOSTS.forEach((g, i) => {
      const expected = lumaNormalized(g.tint).map((c) => c * ghostEnergy(g))
      colors[i].forEach((c, ch) => expect(c / expected[ch]).toBeCloseTo(1, 5))
    })
  })

  it('инстанс: ячейка — i / N, призрак — i % N', () => {
    expect(vert).toContain('int ghost = gl_InstanceID % GHOST_COUNT;')
    expect(vert).toContain('int cellIndex = gl_InstanceID / GHOST_COUNT;')
    expect(vert).toContain(`#define GHOST_COUNT ${FLARE_GHOSTS.length}`)
  })
})

describe('FlareGhostMaterial: формулы', () => {
  it('положение призрака — m · источник', () => {
    expect(vert).toContain('vec2 center = GHOST_M[ghost] * source;')
  })

  it('виньетирование без pow(0, 0): показатель 0 даёт единицу', () => {
    expect(vert).toContain('exp2(ghostVignette * log2(max(1.0 - r * r, 1e-6)))')
  })

  it('отсечка по экранной яркости с ghostAmount и intensity', () => {
    expect(vert).toContain('float peak = flareLuma(color) * GHOST_PEAK[ghost] * ghostAmount * intensity;')
    expect(vert).toContain('if (flux.a <= 0.0 || peak < GHOST_CUTOFF)')
  })

  it('вершинник без luminance() — вычисляет локально', () => {
    expect(vert).toContain('float flareLuma(vec3 c)')
    expect(vert).not.toContain('luminance(')
  })

  it('каёмка: красный снаружи, синий внутри', () => {
    expect(frag).toContain(
      'ghostProfile(rho / (1.0 + ghostChromatic)) / ((1.0 + ghostChromatic) * (1.0 + ghostChromatic))'
    )
    expect(frag).toContain(
      'ghostProfile(rho / (1.0 - ghostChromatic)) / ((1.0 - ghostChromatic) * (1.0 - ghostChromatic))'
    )
  })

  it('потолок half-float', () => {
    expect(frag).toContain('min(vColor * profile, vec3(60000.0))')
  })
})

describe('FlareGhostMaterial: проводка', () => {
  it('общие ручки — те же объекты Uniform, что у композита', () => {
    expect(material.uniforms.ghostAmount).toBe(shared.ghostAmount)
    expect(material.uniforms.intensity).toBe(shared.intensity)
  })

  it('сложение без глубины', () => {
    expect(material.blending).toBe(CustomBlending)
    expect(material.blendEquation).toBe(AddEquation)
    expect(material.blendSrc).toBe(OneFactor)
    expect(material.blendDst).toBe(OneFactor)
    expect(material.depthTest).toBe(false)
    expect(material.depthWrite).toBe(false)
  })

  it('setGrid: размер сетки и аспект', () => {
    material.setGrid(64, 36, 16 / 9)

    expect(material.uniforms.gridSize.value).toEqual(new Vector2(64, 36))
    expect(material.uniforms.aspect.value).toBeCloseTo(16 / 9, 12)
  })

  it('ручки виньетирования и каёмки', () => {
    material.ghostVignette = 3
    material.ghostChromatic = 0.05

    expect(material.uniforms.ghostVignette.value).toBe(3)
    material.ghostVignette = -1
    expect(material.uniforms.ghostVignette.value).toBe(0)
    material.ghostVignette = 3
    expect(material.ghostVignette).toBe(3)
    expect(material.ghostChromatic).toBe(0.05)
  })

  it('каёмка: зажата в [0, 0.5]', () => {
    material.ghostChromatic = 2
    expect(material.ghostChromatic).toBe(0.5)

    material.ghostChromatic = -1
    expect(material.ghostChromatic).toBe(0)

    material.ghostChromatic = 0.05
    expect(material.ghostChromatic).toBe(0.05)
  })
})
