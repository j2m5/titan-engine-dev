import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { nebulaDensityChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaDensity'

/** Внешний радиус контура вдоль направления: последний r ∈ [0, 1.5], где граница ≥ 0.5 (скан, полость внутри не мешает) */
function outlineRadius(field: NebulaField, dir: Vector3): number {
  const p = new Vector3()
  let last = 0
  for (let r = 0; r <= 1.5; r += 0.001) {
    if (field.boundaryAt(p.copy(dir).multiplyScalar(r)) >= 0.5) last = r
  }
  return last
}

const sphereShell = (extra: Partial<Parameters<typeof mergeNebulaParams>[0]> = {}) =>
  mergeNebulaParams({ seed: 5, shape: 'shell', shapeThickness: 0.35, axisRatios: new Vector3(1, 1, 1), ...extra })

const directions = [
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, 1),
  new Vector3(1, 1, 0).normalize(),
  new Vector3(-1, 0.3, 0.7).normalize(),
  new Vector3(0.2, -1, -0.5).normalize()
]

describe('noise.boundaryWarp: варп самого контура формы', () => {
  it('дефолт 0, кламп в [0, 1]', () => {
    expect(mergeNebulaParams().noise.boundaryWarp).toBe(0)
    expect(mergeNebulaParams({ noise: { boundaryWarp: -1 } }).noise.boundaryWarp).toBe(0)
    expect(mergeNebulaParams({ noise: { boundaryWarp: 3 } }).noise.boundaryWarp).toBe(1)
  })

  it('при 0 контур и плотность совпадают с аналитической границей бит-в-бит', () => {
    const field = new NebulaField(sphereShell())
    for (const dir of directions) {
      for (const r of [0.3, 0.6, 0.75, 0.9, 1.0]) {
        const p = dir.clone().multiplyScalar(r)
        expect(field.boundaryAt(p)).toBe(field.boundary(p))
      }
    }
  })

  it('при 0.3 радиус контура оболочки по разным направлениям расходится с аналитическим (не сфера)', () => {
    const plain = new NebulaField(sphereShell())
    const warped = new NebulaField(sphereShell({ noise: { boundaryWarp: 0.3 } }))
    const analytic = directions.map((d) => outlineRadius(plain, d))
    const radii = directions.map((d) => outlineRadius(warped, d))

    // Аналитический контур — сфера: все радиусы одинаковы (с точностью шага скана)
    for (const r of analytic) expect(r).toBeCloseTo(analytic[0], 2)
    const spread = Math.max(...radii) - Math.min(...radii)
    expect(spread).toBeGreaterThan(0.05)
    // Варп сдвигает, а не разрушает: каждый радиус в разумной окрестности единицы
    for (const r of radii) {
      expect(r).toBeGreaterThan(0.5)
      expect(r).toBeLessThan(1.4)
    }
  })

  it('внутренняя кромка оболочки сдвигается тем же вектором: стенка остаётся связной по толщине', () => {
    const warped = new NebulaField(sphereShell({ noise: { boundaryWarp: 0.3 } }))
    for (const dir of directions) {
      const outer = outlineRadius(warped, dir)
      // Внутри стенки (на четверть толщины от внешней кромки) граница ещё высокая
      expect(warped.boundaryAt(dir.clone().multiplyScalar(outer - 0.35 * 0.25))).toBeGreaterThan(0.5)
    }
  })

  it('GLSL: юниформ uBoundaryWarp проведён из данных, граница считается в сдвинутой точке', () => {
    const m = new NebulaRaymarchMaterial(mergeNebulaParams({ noise: { boundaryWarp: 0.25 } }))

    expect(m.uniforms.uBoundaryWarp.value).toBe(0.25)
    expect(nebulaDensityChunk).toContain('uniform float uBoundaryWarp;')
    expect(nebulaDensityChunk).toMatch(/nebBoundary\(p \+ uBoundaryWarp \* w\)/)
  })
})
