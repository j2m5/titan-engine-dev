import { describe, expect, it } from 'vitest'
import { slopeRangeForPath } from '../../scripts/lib/slopeRangeFromDb'
import type { IResource } from '@/core/models/types'

const rows: IResource[] = [
  { id: 1, resourceType: 'slope', lifecycle: 'streamable', path: 'a/a_slope.webp', slopeRange: 0.5 },
  { id: 2, resourceType: 'slope', lifecycle: 'streamable', path: 'b/b_slope.webp' },
  { id: 3, resourceType: 'slope', lifecycle: 'streamable', path: 'c/c_slope.webp', slopeRange: 0.3 }
]

describe('slopeRangeForPath', () => {
  it('возвращает объявленный диапазон', () => {
    expect(slopeRangeForPath('a/a_slope.webp', rows)).toBe(0.5)
  })
  it('без поля — ошибка с путём и подсказкой про --recommend', () => {
    expect(() => slopeRangeForPath('b/b_slope.webp', rows)).toThrow(/b_slope\.webp.*recommend/s)
  })
  it('вне сетки — ошибка', () => {
    expect(() => slopeRangeForPath('c/c_slope.webp', rows)).toThrow(/сетк/i)
  })
  it('неизвестный путь — ошибка', () => {
    expect(() => slopeRangeForPath('zzz', rows)).toThrow(/zzz/)
  })
})
