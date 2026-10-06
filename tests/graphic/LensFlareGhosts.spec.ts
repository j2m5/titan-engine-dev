import { describe, expect, it } from 'vitest'
import {
  LENS_FLARE_GHOSTS,
  LensFlareFeaturesMaterial,
  ghostEnergy
} from '@/core/graphic/effects/lensflare/LensFlareFeaturesMaterial'

/**
 * Призрак выбирает буфер в suv = 1 − uv + (uv − 0.5)·offset (sampleGhost):
 * источник в s рисуется в c + (s − c)·m, m = 1/(offset − 1).
 */
function ghostSampleUv(uv: [number, number], offset: number): [number, number] {
  const clamp = (x: number): number => Math.min(Math.max(x, 0), 1)
  return [clamp(1 - uv[0] + (uv[0] - 0.5) * offset), clamp(1 - uv[1] + (uv[1] - 0.5) * offset)]
}

/** Вызовы sampleGhost собранного шейдера: [вес, offset] */
function shaderGhosts(): Array<[number, number]> {
  const source = new LensFlareFeaturesMaterial().fragmentShader
  const calls = [...source.matchAll(/color \+= sampleGhost\(direction, ([-\d.e]+), ([-\d.e]+)\);/g)]
  return calls.map((m) => [Number(m[1]), Number(m[2])])
}

describe('призраки объектива: масштаб и энергия', () => {
  it('источник в центре кадра не заливает кадр: угол кадра не читает центр ни у одного призрака', () => {
    // Призрак с offset = 1 вырожден (m = ∞): каждый пиксель кадра читал центр
    // экрана, и звезда в центре заливала собой весь кадр. 12 px звезды в
    // половинном буфере 1080p — около 0.006 высоты
    const sourceRadius = 0.006
    for (const [, offset] of shaderGhosts()) {
      for (const corner of [[0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98]] as Array<[number, number]>) {
        const [x, y] = ghostSampleUv(corner, offset)
        expect(Math.hypot(x - 0.5, y - 0.5), `offset ${offset}`).toBeGreaterThan(sourceRadius)
      }
    }
  })

  it('масштаб каждого призрака конечен: не крупнее источника вчетверо', () => {
    for (const { offset } of LENS_FLARE_GHOSTS) {
      expect(Math.abs(1 / (offset - 1)), `offset ${offset}`).toBeLessThanOrEqual(4)
    }
  })

  it('увеличенная в |m| раз копия тускнеет в m² раз, уменьшенная не ярче источника', () => {
    // offset 0.7 → m = −1/0.3: площадь ×11, яркость ÷11
    expect(ghostEnergy(0.7)).toBeCloseTo(0.09, 12)
    // offset −5 → m = −1/6: буквальная m² сделала бы копию ярче источника ×36
    expect(ghostEnergy(-5)).toBe(1)
    expect(ghostEnergy(2.5)).toBe(1)
    expect(ghostEnergy(10)).toBe(1)
  })

  it('шейдер собран из таблицы: вес × энергия, по вызову на призрак', () => {
    const calls = shaderGhosts()

    expect(calls).toHaveLength(LENS_FLARE_GHOSTS.length)
    LENS_FLARE_GHOSTS.forEach(({ weight, offset }, i) => {
      expect(calls[i][0]).toBeCloseTo(weight * ghostEnergy(offset), 6)
      expect(calls[i][1]).toBe(offset)
    })
  })
})
