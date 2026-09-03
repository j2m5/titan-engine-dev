import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { ellipseFromCovariance, silhouetteRadius, SILHOUETTE_EDGE_AMP } from './billboardMirror'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { Actor } from '@/core/models/Actor'
import { poolOf } from '../helpers/ringSystemInternals'

describe('Эллипс проекции инстанса (зеркало вершинника билборда)', () => {
  it('единичная ковариация — круг', () => {
    const e = ellipseFromCovariance(1, 0, 1)
    expect(e.ra).toBeCloseTo(1, 12)
    expect(e.rb).toBeCloseTo(1, 12)
  })

  it('диагональная ковариация: полуоси — корни диагонали, большая ось вдоль X', () => {
    const e = ellipseFromCovariance(4, 0, 1)
    expect(e.ra).toBeCloseTo(2, 12)
    expect(e.rb).toBeCloseTo(1, 12)
    expect(e.theta).toBeCloseTo(0, 12)
  })

  it('поворот на 45°: эллипс 2×1, повёрнутый на 45°, восстанавливается', () => {
    // Q = R·diag(4,1)·Rᵀ при θ = 45°: a = c = 2.5, b = 1.5
    const e = ellipseFromCovariance(2.5, 1.5, 2.5)
    expect(e.ra).toBeCloseTo(2, 12)
    expect(e.rb).toBeCloseTo(1, 12)
    expect(e.theta).toBeCloseTo(Math.PI / 4, 12)
  })

  it('вырожденная ковариация не даёт NaN и нулевой полуоси', () => {
    const e = ellipseFromCovariance(1, 1, 1)
    expect(Number.isFinite(e.ra)).toBe(true)
    expect(e.rb).toBeGreaterThan(0)
  })
})

describe('Гармоники края силуэта (зеркало billboardSilhouette)', () => {
  it('радиус в [1 − amp, 1] при любом сиде и угле', () => {
    for (const seed of [0, 0.13, 0.5, 0.77, 0.999]) {
      for (let i = 0; i < 360; i++) {
        const r = silhouetteRadius((i / 180) * Math.PI, seed)
        expect(r).toBeGreaterThanOrEqual(1 - SILHOUETTE_EDGE_AMP - 1e-12)
        expect(r).toBeLessThanOrEqual(1 + 1e-12)
      }
    }
  })

  it('гладкий и периодичный: соседние углы отличаются мало, 0 и 2π совпадают', () => {
    const seed = 0.42
    const step = Math.PI / 180
    for (let i = 0; i < 360; i++) {
      const d = Math.abs(silhouetteRadius(i * step, seed) - silhouetteRadius((i + 1) * step, seed))
      expect(d).toBeLessThan(0.01)
    }
    expect(silhouetteRadius(0, seed)).toBeCloseTo(silhouetteRadius(2 * Math.PI, seed), 9)
  })

  it('разные сиды дают разные силуэты', () => {
    expect(silhouetteRadius(1, 0.1)).not.toBeCloseTo(silhouetteRadius(1, 0.6), 3)
  })
})

describe('BillboardAsteroidMaterial: силуэт по матрице инстанса', () => {
  const make = () => new BillboardAsteroidMaterial()

  it('вершинник строит эллипс проекции из ковариации A·Aᵀ, A = view·instance', () => {
    const vs = make().vertexShader
    expect(vs).toContain('mat3 A = mat3(modelViewMatrix) * mat3(instanceMatrix);')
    // Зеркало ellipseFromCovariance
    expect(vs).toContain('float theta = 0.5 * atan(2.0 * qb, qa - qc);')
    expect(vs).toContain('vEllipse = vec4(ra, rb, cos(theta), sin(theta));')
    // Плейн ужат до описанного прямоугольника эллипса
    expect(vs).toContain('float halfExtent = max(ra, rb) * 1.1;')
    expect(vs).toContain('vHalfExtent = halfExtent;')
    // Анизотропия архетипа по сиду и средний радиус силуэта
    expect(vs).toContain('uSilhouetteScale')
    // Старый масштаб по одной оси матрицы больше не задаёт размер плейна
    expect(vs).not.toContain('instanceMatrix[0][0],')
  })

  it('фрагмент: эллипс + плавные гармоники края вместо белого шума по углу', () => {
    const fs = make().fragmentShader
    expect(fs).toContain('float billboardSilhouette(float phi, float seed)')
    // Зеркало silhouetteRadius
    expect(fs).toContain('1.0 - 0.12 * (0.6 * h2 + 0.4 * h3)')
    expect(fs).toContain('vec2 u = q / vEllipse.xy;')
    expect(fs).toContain('if (r > edge) discard;')
    expect(fs).not.toContain('hash(vec2(angle')
    expect(fs).not.toContain('0.82')
    // AA кромки экранными производными, не фиксированной шириной
    expect(fs).toContain('fwidth(r)')
  })

  it('нормаль — масштабированная сфера по осям эллипса, повёрнутая обратно во view', () => {
    const fs = make().fragmentShader
    expect(fs).toContain('vec3 nl = normalize(vec3(un.x / vEllipse.x, un.y / vEllipse.y, z / rm));')
    expect(fs).toContain('vec3 normal = vec3(cs * nl.x - sn * nl.y, sn * nl.x + cs * nl.y, nl.z);')
  })

  it('идентичность: пер-инстансный джиттер яркости из профиля', () => {
    const m = make()
    expect(m.uniforms.uColorJitter.value).toBe(0.1)
    expect(m.uniforms.uSilhouetteScale.value).toBe(0.85)
    expect(m.fragmentShader).toContain('uColor * (1.0 + uColorJitter * (vInstanceSeed - 0.5) * 2.0)')
  })
})

describe('AsteroidRingSystem: джиттер билборда из профиля', () => {
  const makeFakeActor = (): Actor =>
    ({
      getAttribute: () => 42,
      renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) }
    }) as unknown as Actor

  it('uColorJitter билборда равен colorJitter профиля', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { profile: 'metallic' })
    const l1 = poolOf(system).billboardMaterial.uniforms
    expect(l1.uColorJitter.value).toBe(ASTEROID_PROFILES.metallic.colorJitter)
  })
})
