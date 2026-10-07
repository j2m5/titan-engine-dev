import { describe, expect, it } from 'vitest'
import { CustomBlending, OneFactor, Texture, Uniform, Vector2 } from 'three'
import { FlareStarburstMaterial } from '@/core/graphic/effects/lensflare/FlareStarburstMaterial'
import { glslFloat } from '@/core/graphic/effects/lensflare/glslLiteral'
import {
  STARBURST_ANGLES_DEG,
  STARBURST_CORE,
  STARBURST_DISPERSION,
  STARBURST_KAPPA,
  STARBURST_WIDTH
} from '@/core/graphic/effects/lensflare/flareStarburst'

const shared = { starburstAmount: new Uniform(1), intensity: new Uniform(0.1) }
const material = new FlareStarburstMaterial(shared, new Texture(), new Texture())
const vert = material.vertexShader
const frag = material.fragmentShader

function directions(source: string): number[][] {
  const match = source.match(/const vec2 SPIKE_DIRECTIONS\[3\] = vec2\[3\]\((.*)\);/)
  if (!match) throw new Error('SPIKE_DIRECTIONS не найден')
  return [...match[1].matchAll(/vec2\(([^)]*)\)/g)].map((m) => m[1].split(',').map(Number))
}

describe('FlareStarburstMaterial: геометрия', () => {
  it('направления лучей — из углов TS', () => {
    const dirs = directions(frag)
    STARBURST_ANGLES_DEG.forEach((angle, i) => {
      expect(dirs[i][0]).toBeCloseTo(Math.cos((angle * Math.PI) / 180), 6)
      expect(dirs[i][1]).toBeCloseTo(Math.sin((angle * Math.PI) / 180), 6)
    })
  })

  it('горизонтального луча нет', () => {
    for (const [, y] of directions(frag)) expect(Math.abs(y)).toBeGreaterThan(0.4)
  })
})

describe('FlareStarburstMaterial: формулы и константы', () => {
  it('константы — из TS', () => {
    expect(vert).toContain(`#define STARBURST_KAPPA ${glslFloat(STARBURST_KAPPA)}`)
    expect(vert).toContain(`#define STARBURST_CORE ${glslFloat(STARBURST_CORE)}`)
    expect(frag).toContain(`#define STARBURST_WIDTH ${glslFloat(STARBURST_WIDTH)}`)
    expect(frag).toContain(`const vec3 DISPERSION = vec3(${STARBURST_DISPERSION.map(glslFloat).join(', ')});`)
  })

  it('поток в пикселях 1080p', () => {
    expect(vert).toContain(`#define FLUX_TO_PIXELS ${glslFloat(1080 * 1080)}`)
    expect(vert).toContain('float fluxPixels = flux.a * FLUX_TO_PIXELS;')
  })

  it('вход по порогу без smoothstep(0, 0)', () => {
    expect(vert).toContain(
      'starburstMinFlux > 0.0 ? smoothstep(starburstMinFlux, 2.0 * starburstMinFlux, fluxPixels) : 1.0'
    )
  })

  it('профиль: I₀·k / (1 + r·k/r₀)², поперёк гаусс', () => {
    expect(frag).toContain('vec3 falloff = 1.0 + along * DISPERSION / STARBURST_CORE;')
    expect(frag).toContain('color += vI0 * DISPERSION / (falloff * falloff) * exp(-across * across);')
  })

  it('вершинник без luminance(): у three она есть только во фрагментном прологе', () => {
    expect(vert).not.toContain('luminance(')
    expect(vert).toContain('float i0Screen = flareLuma(i0) * starburstAmount * intensity;')
  })

  it('квад — красный канал до ε, в пределах [r₀, потолок]', () => {
    expect(vert).toContain('clamp(reach, STARBURST_CORE, STARBURST_MAX_LENGTH)')
  })

  it('потолок half-float', () => {
    expect(frag).toContain('min(color, vec3(60000.0))')
  })
})

describe('FlareStarburstMaterial: проводка', () => {
  it('общие ручки — те же объекты Uniform, что у композита', () => {
    expect(material.uniforms.starburstAmount).toBe(shared.starburstAmount)
    expect(material.uniforms.intensity).toBe(shared.intensity)
  })

  it('сложение без глубины', () => {
    expect(material.blending).toBe(CustomBlending)
    expect(material.blendSrc).toBe(OneFactor)
    expect(material.blendDst).toBe(OneFactor)
    expect(material.depthTest).toBe(false)
  })

  it('setGrid и порог', () => {
    material.setGrid(86, 36, 2560 / 1080)
    material.starburstMinFlux = 300

    expect(material.uniforms.gridSize.value).toEqual(new Vector2(86, 36))
    expect(material.uniforms.aspect.value).toBeCloseTo(2560 / 1080, 12)
    expect(material.uniforms.starburstMinFlux.value).toBe(300)
  })
})
