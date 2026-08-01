import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { ringShineFunctions, ringShineUniforms } from '@/core/materials/shaders/lib/chunks/RingShine'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { ringShineSum, Vec3 } from './ringShineMirror'

const R = 1
const INNER = 1.5
const OUTER = 2.5
const FULL_RING = (): number => 1

// Солнце светит вдоль +X: свет распространяется в +X, значит ночная сторона — при x > 0
const LIGHT: Vec3 = { x: 1, y: 0, z: 0 }

describe('RingShine: отсвет колец на ночную сторону', () => {
  it('чанки зарегистрированы — иначе include молча раскроется в пустоту', () => {
    expect(AppShaderChunk.ringShineFunctions).toBe(ringShineFunctions)
    expect(AppShaderChunk.ringShineUniforms).toBe(ringShineUniforms)
  })

  it('точка средних широт ночной стороны получает отсвет', () => {
    const n: Vec3 = { x: 0.7071, y: 0.7071, z: 0 }
    const pos: Vec3 = { x: 0.7071 * R, y: 0.7071 * R, z: 0 }

    expect(ringShineSum(n, pos, LIGHT, R, INNER, OUTER, FULL_RING, 1)).toBeGreaterThan(0)
  })

  it('на экваторе кольцо ребром — вклад практически нулевой', () => {
    const n: Vec3 = { x: 1, y: 0, z: 0 }
    const pos: Vec3 = { x: R, y: 0, z: 0 }
    const equator = ringShineSum(n, pos, LIGHT, R, INNER, OUTER, FULL_RING, 1)

    const nMid: Vec3 = { x: 0.7071, y: 0.7071, z: 0 }
    const posMid: Vec3 = { x: 0.7071 * R, y: 0.7071 * R, z: 0 }
    const mid = ringShineSum(nMid, posMid, LIGHT, R, INNER, OUTER, FULL_RING, 1)

    expect(equator).toBeLessThan(mid)
  })

  it('кольцо в тени планеты светит слабее, чем освещённое', () => {
    const n: Vec3 = { x: 0.7071, y: 0.7071, z: 0 }
    const pos: Vec3 = { x: 0.7071 * R, y: 0.7071 * R, z: 0 }

    const lit = ringShineSum(n, pos, { x: -1, y: 0, z: 0 }, R, INNER, OUTER, FULL_RING, 1)
    const shadowed = ringShineSum(n, pos, LIGHT, R, INNER, OUTER, FULL_RING, 1)

    expect(shadowed).toBeLessThan(lit)
  })

  it('пустая полоса кольца отсвета не даёт', () => {
    const n: Vec3 = { x: 0.7071, y: 0.7071, z: 0 }
    const pos: Vec3 = { x: 0.7071 * R, y: 0.7071 * R, z: 0 }

    expect(ringShineSum(n, pos, LIGHT, R, INNER, OUTER, () => 0, 1)).toBe(0)
  })

  it('над самым полюсом кольцо симметрично — вклад гасится', () => {
    const n: Vec3 = { x: 0, y: 1, z: 0 }
    const pos: Vec3 = { x: 0, y: R, z: 0 }

    expect(ringShineSum(n, pos, LIGHT, R, INNER, OUTER, FULL_RING, 1)).toBe(0)
  })

  it('шейдер зовёт отсвет под гейтом колец и добавляет его ДО клампа 0.99', () => {
    const src = PlanetShaderTemplate.fragmentShader
    expect(src).toContain('night += getRingShine(')
    expect(src.indexOf('night += getRingShine(')).toBeLessThan(src.indexOf('clamp(finalColor, 0.0, 0.99)'))
  })

  it('сила отсвета объявлена в шаблоне и в рантайм-юниформах одинаково', () => {
    expect(PlanetShaderTemplate.uniforms.uRingShineStrength.value).toBe(1.0)
  })
})
