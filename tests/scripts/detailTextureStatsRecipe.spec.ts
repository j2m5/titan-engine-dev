import { describe, expect, it } from 'vitest'
import { clampedLumaMean, clampedMean } from '../../scripts/lib/detailTextureStats'

describe('clampedMean: среднее с учётом клампа шейдера', () => {
  it('без хвоста выше 2·mean совпадает с обычным средним', () => {
    expect(clampedMean([0.2, 0.3, 0.4])).toBeCloseTo(0.3, 9)
  })

  it('с ярким хвостом — ниже обычного среднего, и mean(min(2m, v)) = m', () => {
    const v = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 5]
    const m = clampedMean(v)
    expect(m).toBeLessThan(0.59)
    const check = v.reduce((s, x) => s + Math.min(2 * m, x), 0) / v.length
    expect(check).toBeCloseTo(m, 6)
  })
})

describe('clampedLumaMean: кламп ПЕР КАНАЛ, а не поверх готовой люмы', () => {
  it('серое изображение (r = g = b) даёт тот же результат, что clampedMean по люме', () => {
    const grey = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.9]
    const viaLuma = clampedMean(grey)
    const viaChannels = clampedLumaMean(grey, grey, grey)
    expect(viaChannels).toBeCloseTo(viaLuma, 9)
  })

  it('насыщенно-красный хвост клампится по каналу — значение не выше люма-клампнутого варианта', () => {
    // Хвост целиком в R: люма хвоста мала (0.2126·1 = 0.2126), поэтому
    // кламп ПОСЛЕ люмы почти не режет его — а кламп ПО КАНАЛУ обрезает
    // сам r=1 раньше взвешивания, и итог оказывается не выше.
    const base = 8
    const r = [...Array(base).fill(0.1), 1]
    const g = [...Array(base).fill(0.1), 0]
    const b = [...Array(base).fill(0.1), 0]
    const lumaOfAll = r.map((rv, i) => 0.2126 * rv + 0.7152 * g[i] + 0.0722 * b[i])

    const viaLumaClamp = clampedMean(lumaOfAll)
    const viaChannelClamp = clampedLumaMean(r, g, b)

    expect(viaChannelClamp).toBeLessThanOrEqual(viaLumaClamp + 1e-9)
  })
})
