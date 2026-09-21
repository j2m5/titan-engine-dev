import { describe, it, expect } from 'vitest'
import { giantStarSurface } from '@/core/materials/shaders/lib/chunks/GiantStarSurface'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { planckX } from '@/core/materials/shaders/lib/helpers'
import { giantStarCellEnergy } from '@/core/renderables/GiantStar/GiantStarParameters'
import { withoutComments } from '../helpers/glsl'
import { gsCompose, gsEnergy, GS_HDR_CEILING } from './giantStarSurfaceMirror'
import { type Vec3 } from '../helpers/planckLimbMirror'

const COOL: Vec3 = [1, 0.3, 0.1]
const BASE: Vec3 = [1, 0.5, 0.2]
const HOT: Vec3 = [1, 0.7, 0.4]
const ENERGY: Vec3 = giantStarCellEnergy(3700, 700)
const X: Vec3 = planckX(3700)

describe('gsEnergy — энергия ячейки', () => {
  it('три стопа воспроизводятся точно', () => {
    expect(gsEnergy(0, ENERGY)).toBe(ENERGY[0])
    expect(gsEnergy(0.5, ENERGY)).toBe(ENERGY[1])
    expect(gsEnergy(1, ENERGY)).toBe(ENERGY[2])
  })

  it('монотонна по t: горячая ячейка не бывает тусклее холодной', () => {
    const samples: number[] = [0, 0.25, 0.5, 0.75, 1].map((t: number) => gsEnergy(t, ENERGY))

    samples.forEach((value: number, i: number) => {
      if (i > 0) expect(value).toBeGreaterThan(samples[i - 1])
    })
  })
})

describe('gsCompose — композиция тела', () => {
  it('погашенное зерно (t = 0.5) в центре диска даёт ровно базу', () => {
    expect(gsCompose(0.5, 1, COOL, BASE, HOT, ENERGY, X, 2, 1)).toEqual([2, 1, 0.4])
  })

  it('кромка темнее центра и краснее его', () => {
    const centre: Vec3 = gsCompose(0.5, 1, COOL, BASE, HOT, ENERGY, X, 2, 1)
    const limb: Vec3 = gsCompose(0.5, 0, COOL, BASE, HOT, ENERGY, X, 2, 1)

    expect(limb[0]).toBeLessThan(centre[0])
    expect(limb[2] / limb[0]).toBeLessThan(centre[2] / centre[0])
  })

  it('потолок HDR — предохранитель', () => {
    gsCompose(1, 1, COOL, BASE, [1, 1, 1], ENERGY, X, 1e4, 1).forEach((value: number) => {
      expect(value).toBe(GS_HDR_CEILING)
    })
  })

  it('экспозиция умножается ПОСЛЕ потолка', () => {
    expect(gsCompose(1, 1, COOL, BASE, [1, 1, 1], ENERGY, X, 1e4, 0.5)[0]).toBe(GS_HDR_CEILING * 0.5)
  })

  it('нулевая интенсивность гасит тело', () => {
    expect(gsCompose(0.7, 0.4, COOL, BASE, HOT, ENERGY, X, 0, 1)).toEqual([0, 0, 0])
  })

  it('на всём диапазоне значения конечны', () => {
    for (const t of [0, 0.3, 0.5, 0.9, 1]) {
      for (const mu of [0, 0.001, 0.5, 1]) {
        gsCompose(t, mu, COOL, BASE, HOT, ENERGY, X, 2, 1).forEach((value: number) => {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
        })
      }
    }
  })
})

describe('чанк giantStarSurface — структура', () => {
  const code: string = withoutComments(giantStarSurface)

  it('зарегистрирован в реестре', () => {
    expect(AppShaderChunk.giantStarSurface).toBe(giantStarSurface)
  })

  it('константа потолка синхронизирована с зеркалом', () => {
    expect(giantStarSurface).toContain(`#define GS_HDR_CEILING ${GS_HDR_CEILING.toFixed(1)}`)
  })

  it('сам ничего не включает — зависимости подключает потребитель', () => {
    expect(giantStarSurface).not.toContain('#include')
  })

  it('погашенное поле не считает шум вовсе', () => {
    expect(code).toContain('if (fadeLanes <= 0.0) return 0.5;')
  })

  it('прожилки гаснут по СВОЕМУ масштабу — они крупнее ячеек и уходят последними', () => {
    expect(code).toContain('float fadeLanes = starGranulationFade(domainPerPixel * GS_LANE_SCALE);')
    expect(code).toContain('snoise(vec4(domain * GS_LANE_SCALE + 31.0, time * 0.5))')
  })

  it('ячейки не считаются, пока живы одни прожилки', () => {
    expect(code).toContain('if (fadeCells <= 0.0) return lanesOnly;')
  })

  it('вблизи результат — полное поле, вдали — одни прожилки', () => {
    expect(code).toContain('return mix(lanesOnly, clamp(t, 0.0, 1.0), fadeCells);')
  })

  it('рябь считается только пока жива', () => {
    expect(code).toContain('if (fadeRipple > 0.0)')
  })

  it('горячие пятна заострены квадратом, а не pow — NaN от отрицательного основания исключён', () => {
    expect(code).toContain('float spot = max(t - GS_SPOT_THRESHOLD, 0.0);')
    expect(code).not.toMatch(/pow\s*\(/)
  })

  it('производных внутри чанка нет: масштаб домена приходит аргументом', () => {
    // Импостор зовёт функцию внутри ветки; производная там не определена
    expect(code).not.toMatch(/dFdx|dFdy|fwidth|starDomainPerPixel/)
  })

  it('лимб берётся из общего чанка', () => {
    expect(code).toContain('planckLimb(mu, planckX)')
  })
})
