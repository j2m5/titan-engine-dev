import { describe, expect, it } from 'vitest'
import { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import {
  MAX_OCCLUDERS,
  diskSeparation,
  eclipseLightCpu,
  selectOccluders,
  visibleFraction,
  type Vec3
} from '@/core/eclipse/eclipseMath'
import { umbraTintFromAtmosphere } from '@/core/eclipse/umbraTint'
import { eclipseFunctions, eclipseHostFunctions } from '@/core/materials/shaders/lib/chunks/Eclipse'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

describe('visibleFraction', () => {
  const aS = 0.00465
  it('нет перекрытия и касание — 1', () => {
    expect(visibleFraction(aS, 0.002, 0.01)).toBe(1)
    expect(visibleFraction(aS, 0.002, aS + 0.002)).toBe(1)
  })
  it('полное — 0, кольцевое — 1 − (aO/aS)²', () => {
    expect(visibleFraction(aS, 0.006, 0)).toBe(0)
    expect(visibleFraction(aS, 0.5 * aS, 0)).toBeCloseTo(0.75, 12)
  })
  it('монотонно растёт с θ', () => {
    let prev = -1
    for (let t = 0; t <= 0.012; t += 0.0005) {
      const v = visibleFraction(aS, 0.005, t)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
  })
})

describe('diskSeparation — точный малый угол', () => {
  it('совпадает с acos на больших и точен на малых углах', () => {
    expect(diskSeparation([1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2, 12)
    const small = 1e-4
    expect(diskSeparation([1, 0, 0], unit([Math.cos(small), Math.sin(small), 0]))).toBeCloseTo(small, 12)
  })
})

describe('eclipseLightCpu', () => {
  const star: Vec3 = [-150000, 0, 0]
  const R = 0.00465 * 150000
  it('тело точно между точкой и звездой — полная тень; в стороне — 1', () => {
    const moon = { center: [-100, 0, 0] as Vec3, radius: 1 }
    expect(eclipseLightCpu([0, 0, 0], star, R, [moon])).toEqual([0, 0, 0])
    expect(eclipseLightCpu([0, 50, 0], star, R, [moon])).toEqual([1, 1, 1])
  })
  it('тело позади точки относительно звезды — 1', () => {
    expect(eclipseLightCpu([0, 0, 0], star, R, [{ center: [100, 0, 0], radius: 50 }])).toEqual([1, 1, 1])
  })
  it('умбра с атмосферой подсвечивается её цветом и силой', () => {
    const planet = { center: [-100, 0, 0] as Vec3, radius: 10, umbra: { tint: [1, 0.1, 0] as Vec3, glow: 0.02 } }
    const c = eclipseLightCpu([0, 0, 0], star, R, [planet])
    expect(c[0]).toBeCloseTo(0.02, 12)
    expect(c[1]).toBeCloseTo(0.002, 12)
    expect(c[2]).toBe(0)
  })
  it('нет тел — ровно 1', () => {
    expect(eclipseLightCpu([0, 0, 0], star, R, [])).toEqual([1, 1, 1])
  })
})

describe('selectOccluders', () => {
  const earth: Vec3 = [75000, 0, 0]
  it('Луна соосно между Землёй и звездой — выбрана; сбоку — нет; сам получатель — никогда', () => {
    const cands = [
      { center: [74800, 0, 0] as Vec3, radius: 0.87, actorId: 19 },
      { center: [75000, 190, 0] as Vec3, radius: 0.87, actorId: 99 },
      { center: earth, radius: 3.19, actorId: 7 }
    ]
    expect(selectOccluders(earth, 3.19, 349, cands, 7)).toEqual([0])
  })
  it('не больше MAX_OCCLUDERS и без NaN при совпадающих центрах', () => {
    const cands = Array.from({ length: 8 }, (_, i) => ({ center: [74900 - i, 0, 0] as Vec3, radius: 1, actorId: 100 + i }))
    cands.push({ center: earth, radius: 1, actorId: 200 })
    const sel = selectOccluders(earth, 3.19, 349, cands, 7)
    expect(sel.length).toBe(MAX_OCCLUDERS)
    expect(sel).not.toContain(8)
  })
})

describe('umbraTintFromAtmosphere', () => {
  it('Земля: красный = 1, синий < зелёного < красного', () => {
    const atm = Actor.find(7)!.children.where('categoryId', 5).first()!
    const tint = umbraTintFromAtmosphere(readRenderingData<AtmosphereConfig>(atm)!)
    expect(tint[0]).toBe(1)
    expect(tint[1]).toBeLessThan(tint[0])
    expect(tint[2]).toBeLessThan(tint[1])
  })
})

describe('чанк Eclipse', () => {
  it('зарегистрирован', () => {
    expect(AppShaderChunk.eclipseFunctions).toBe(eclipseFunctions)
    expect(AppShaderChunk.eclipseHostFunctions).toBe(eclipseHostFunctions)
  })
  it('угол — через asin полухорды; ранний выход без тел', () => {
    expect(eclipseFunctions).toContain('return 2.0 * asin(clamp(0.5 * length(nS - nO), 0.0, 1.0));')
    expect(eclipseFunctions).not.toMatch(/acos\(clamp\(dot/)
    expect(eclipseFunctions).toContain('if (count <= 0) return vec3(1.0);')
    expect(eclipseHostFunctions).toContain('uniform vec4 uEclipseOccluders[4];')
    expect(eclipseHostFunctions).toContain('return eclipseLightAt(p, uEclipseCount, uEclipseOccluders, uEclipseStar, uEclipseStarRadius, uEclipseUmbra);')
  })
})
