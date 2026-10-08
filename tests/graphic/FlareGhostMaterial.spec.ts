import { describe, expect, it } from 'vitest'
import { AddEquation, CustomBlending, OneFactor, Texture, Uniform, Vector2 } from 'three'
import { FlareGhostMaterial } from '@/core/graphic/effects/lensflare/FlareGhostMaterial'
import { createSpriteQuad } from '@/core/graphic/effects/lensflare/flareSprites'
import { glslFloat } from '@/core/graphic/effects/lensflare/glslLiteral'
import {
  FLARE_GHOSTS,
  GHOST_COPIES_FADE,
  GHOST_FLUX_GAMMA,
  GHOST_FLUX_KNEE_PIXELS,
  ghostEnergy,
  lumaNormalized
} from '@/core/graphic/effects/lensflare/flareGhosts'
import { FLUX_REFERENCE_HEIGHT } from '@/core/graphic/effects/lensflare/flareGrid'

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
const sourceWindow = new Texture()
const material = new FlareGhostMaterial(shared, new Texture(), new Texture(), sourceWindow)
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
  it('положения, радиусы, формы профиля и разнос каналов', () => {
    const shape = (g: (typeof FLARE_GHOSTS)[number]): number => (g.profile.kind === 'dome' ? g.profile.power : g.profile.core)

    expect(floatArray(vert, 'GHOST_M')).toEqual(FLARE_GHOSTS.map((g) => Number(glslFloat(g.m))))
    expect(floatArray(vert, 'GHOST_RADIUS')).toEqual(FLARE_GHOSTS.map((g) => Number(glslFloat(g.radius))))
    expect(floatArray(vert, 'GHOST_SHAPE')).toEqual(FLARE_GHOSTS.map((g) => Number(glslFloat(shape(g)))))
    expect(floatArray(vert, 'GHOST_HALO')).toEqual(FLARE_GHOSTS.map((g) => (g.profile.kind === 'halo' ? 1 : 0)))
    expect(floatArray(vert, 'GHOST_SPREAD')).toEqual(FLARE_GHOSTS.map((g) => Number(glslFloat(g.spread))))
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

  it('хроматика: каналы на оси в центре ∓ m·δ·χ·s, квад расширен на сдвиг', () => {
    expect(vert).toContain('vec2 delta = GHOST_M[ghost] * GHOST_SPREAD[ghost] * ghostChromatic * source;')
    expect(vert).toContain('vec2 halfSize = radius + abs(delta);')
  })

  it('отсечка по суммарной экранной яркости копий с ghostAmount и intensity: пик профиля 1', () => {
    expect(vert).toContain('float peak = flareLuma(color) * ghostAmount * intensity * max(copies, 1.0);')
    expect(vert).toContain('if (flux.a <= 0.0 || peak < GHOST_CUTOFF)')
  })

  it('копии делят сжатый поток окна; колено, степень и пороги — из TS', () => {
    expect(vert).toContain(`#define GHOST_FLUX_KNEE ${glslFloat(GHOST_FLUX_KNEE_PIXELS / FLUX_REFERENCE_HEIGHT ** 2)}`)
    expect(vert).toContain(`#define GHOST_FLUX_GAMMA ${glslFloat(GHOST_FLUX_GAMMA)}`)
    expect(vert).toContain(`#define GHOST_COPIES_FADE_START ${glslFloat(GHOST_COPIES_FADE.start)}`)
    expect(vert).toContain(`#define GHOST_COPIES_FADE_END ${glslFloat(GHOST_COPIES_FADE.end)}`)
    // Зеркала — fluxResponse, sourceGain, effectiveCopies и ghostCopiesFade
    expect(vert).toContain('vec4 neighbourhood = texelFetch(sourceWindow, cell, 0);')
    expect(vert).toContain('float total = max(neighbourhood.x, flux.a);')
    expect(vert).toContain(
      'float response = total <= GHOST_FLUX_KNEE ? total : GHOST_FLUX_KNEE * pow(total / GHOST_FLUX_KNEE, GHOST_FLUX_GAMMA);'
    )
    expect(vert).toContain('float gain = response / max(total, 1e-30);')
    expect(vert).toContain('float copies = neighbourhood.x * neighbourhood.x / max(neighbourhood.y, 1e-30);')
    expect(vert).toContain('float copiesFade = 1.0 - smoothstep(GHOST_COPIES_FADE_START, GHOST_COPIES_FADE_END, copies);')
    expect(vert).toContain('vec3 color = flux.rgb * GHOST_COLOR[ghost] * vignette * gain * copiesFade;')
  })

  it('без зарезервированного слова centroid: в GLSL ES 3.00 это квалификатор, шейдер не соберётся', () => {
    expect(vert).not.toMatch(/\bcentroid\b/)
    expect(frag).not.toMatch(/\bcentroid\b/)
  })

  it('вершинник без luminance() — вычисляет локально', () => {
    expect(vert).toContain('float flareLuma(vec3 c)')
    expect(vert).not.toContain('luminance(')
  })

  it('каналы: красный в центре − сдвиг (ближе к центру кадра), синий в центре + сдвиг', () => {
    expect(frag).toContain('ghostProfile(length((vOffset + vDelta) / vRadius))')
    expect(frag).toContain('ghostProfile(length(vOffset / vRadius))')
    expect(frag).toContain('ghostProfile(length((vOffset - vDelta) / vRadius))')
  })

  it('профили — зеркало ghostProfile: купол 1 − ρ^p, ореол — лоренциан, доведённый до нуля на краю', () => {
    expect(frag).toContain('if (rho >= 1.0) return 0.0;')
    expect(frag).toContain('float edge = 1.0 / (1.0 + 1.0 / (vShape * vShape));')
    expect(frag).toContain('return (1.0 / (1.0 + rho * rho / (vShape * vShape)) - edge) / (1.0 - edge);')
    expect(frag).toContain('return 1.0 - pow(rho, vShape);')
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

  it('окно источников подключается снаружи', () => {
    expect(material.uniforms.sourceWindow.value).toBe(sourceWindow)
  })

  it('ручки виньетирования и разноса каналов', () => {
    material.ghostVignette = 3
    material.ghostChromatic = 0.05

    expect(material.uniforms.ghostVignette.value).toBe(3)
    material.ghostVignette = -1
    expect(material.uniforms.ghostVignette.value).toBe(0)
    material.ghostVignette = 3
    expect(material.ghostVignette).toBe(3)
    expect(material.ghostChromatic).toBe(0.05)
  })

  it('разнос каналов: множитель зажат в [0, 2]', () => {
    material.ghostChromatic = 3
    expect(material.ghostChromatic).toBe(2)

    material.ghostChromatic = -1
    expect(material.ghostChromatic).toBe(0)

    material.ghostChromatic = 1.5
    expect(material.ghostChromatic).toBe(1.5)
  })
})
