import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { ringshine } from './brdfMirror'
import { asteroidBrdfFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidBrdf'
import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import { poolOf } from '../helpers/ringSystemInternals'

const UP: [number, number, number] = [0, 1, 0]
const WHITE: [number, number, number] = [1, 1, 1]
const H = 100
const sun = (elevationDeg: number): [number, number, number] => {
  const e = (elevationDeg * Math.PI) / 180
  return [Math.cos(e), Math.sin(e), 0]
}

describe('asteroidRingshine — зеркало', () => {
  it('солнечная сторона листа ярче просвета при τ ≈ 1', () => {
    const L = sun(20)
    const above = ringshine([0, -1, 0], UP, [0, 50, 0], L, 1, WHITE, H)[0]
    const below = ringshine([0, 1, 0], UP, [0, -50, 0], L, 1, WHITE, H)[0]
    expect(above).toBeGreaterThan(below)
    expect(below).toBeGreaterThan(0)
  })

  it('пустой лист (τ = 0) и солнце в плоскости кольца — ноль', () => {
    expect(ringshine([0, -1, 0], UP, [0, 50, 0], sun(20), 0, WHITE, H)).toEqual([0, 0, 0])
    expect(ringshine([0, -1, 0], UP, [0, 50, 0], [1, 0, 0], 1, WHITE, H)).toEqual([0, 0, 0])
  })

  it('грань, смотрящая от листа, — ноль; на лист — максимум', () => {
    const L = sun(20)
    expect(ringshine([0, 1, 0], UP, [0, 50, 0], L, 1, WHITE, H)[0]).toBeCloseTo(0, 12)
    const facing = ringshine([0, -1, 0], UP, [0, 50, 0], L, 1, WHITE, H)[0]
    const side = ringshine([1, 0, 0], UP, [0, 50, 0], L, 1, WHITE, H)[0]
    expect(facing).toBeCloseTo(2 * side, 12)
  })

  it('переход через среднюю плоскость непрерывен', () => {
    const L = sun(20)
    let prev = ringshine([0, -1, 0], UP, [0, -10, 0], L, 1, WHITE, H)[0]
    for (let y = -10; y <= 10; y += 0.05) {
      const v = ringshine([0, -1, 0], UP, [0, y, 0], L, 1, WHITE, H)[0]
      expect(Math.abs(v - prev)).toBeLessThan(0.02)
      prev = v
    }
  })

  it('цвет листа множит результат покомпонентно', () => {
    const v = ringshine([0, -1, 0], UP, [0, 50, 0], sun(20), 1, [1, 0.5, 0.25], H)
    expect(v[1]).toBeCloseTo(v[0] * 0.5, 12)
    expect(v[2]).toBeCloseTo(v[0] * 0.25, 12)
  })
})

describe('asteroidRingshine — шейдеры', () => {
  it('функция в чанке AsteroidBrdf с формулами зеркала', () => {
    expect(asteroidBrdfFunctions).toContain(
      'vec3 asteroidRingshine(vec3 N, vec3 ringNormalView, vec3 ringPos, vec3 lightDirRing, float tau, vec3 sheetColor, float halfThickness)'
    )
    expect(asteroidBrdfFunctions).toContain('float lit = mu0 * (1.0 - exp(-tau / mu0));')
    expect(asteroidBrdfFunctions).toContain('float through = tau * exp(-tau / mu0);')
  })

  it('L0 и L1: вызов под uRingBandEnabled, сила uRingshineStrength, тень планеты, цвет листа по пространству текстуры', () => {
    const l0 = InstancedAsteroidShaderTemplate.fragmentShader
    const l1 = new BillboardAsteroidMaterial().fragmentShader
    for (const frag of [l0, l1]) {
      expect(frag).toContain('uniform float uRingshineStrength;')
      expect(frag).toContain('uniform float uRingBandSrgb;')
      expect(frag).toContain('if (uRingBandEnabled > 0.5 && uRingshineStrength > 0.0) {')
      // Байты полос декодируются из sRGB только у sRGB-текстуры кольца (меш кольца
      // показывает NoColorSpace-текстуру как линейную)
      expect(frag).toContain('vec3 band = ringBandAt(ringR).rgb;')
      expect(frag).toContain('vec3 sheetColor = mix(band, pow(band, vec3(2.2)), uRingBandSrgb);')
      expect(frag).not.toContain('pow(ringBandAt(ringR).rgb, vec3(2.2))')
      expect(frag).toContain(
        'asteroidRingshine(normal, normalize(vRingNormalView), vRingPos, uDustLightDirRing, ringLayerTau(ringR), sheetColor, uLayerHalfThickness)'
      )
      expect(frag).toContain('uRingshineStrength * planetShadow')
    }
    const vertices = [InstancedAsteroidShaderTemplate.vertexShader, new BillboardAsteroidMaterial().vertexShader]
    for (const vs of vertices) {
      expect(vs).toContain('vRingNormalView = normalize(mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0));')
    }
  })

  it('uRingBandSrgb по умолчанию 0 (линейные байты) в L0 (шаблон и шейдер) и L1', () => {
    const uniforms = [
      InstancedAsteroidShaderTemplate.uniforms,
      new InstancedAsteroidShader().uniforms,
      new BillboardAsteroidMaterial().uniforms
    ]
    for (const u of uniforms) expect(u.uRingBandSrgb.value).toBe(0)
  })
})

describe('AsteroidRingSystem: ringshineStrength', () => {
  const actorWith = (extra: Record<string, unknown>): Actor =>
    ({
      getAttribute: () => 42,
      renderingObject: {
        getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, ...extra })
      }
    }) as unknown as Actor

  it('дефолт 1 в L0 и L1', () => {
    const system = new AsteroidRingSystem(actorWith({}))
    for (const u of [poolOf(system).geometryMaterial.uniforms, poolOf(system).billboardMaterial.uniforms]) {
      expect(u.uRingshineStrength.value).toBe(1)
    }
  })

  it('данные задают силу', () => {
    const system = new AsteroidRingSystem(actorWith({ ringshineStrength: 0.5 }))
    for (const u of [poolOf(system).geometryMaterial.uniforms, poolOf(system).billboardMaterial.uniforms]) {
      expect(u.uRingshineStrength.value).toBe(0.5)
    }
  })
})
