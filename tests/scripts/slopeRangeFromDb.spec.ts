import { describe, expect, it } from 'vitest'
import { resolveSlopeRanges, slopeRangeForPath } from '../../scripts/lib/slopeRangeFromDb'
import type { IResource } from '@/core/models/types'

const rows: IResource[] = [
  { id: 1, resourceType: 'slope', lifecycle: 'streamable', path: 'a/a_slope.webp', slopeRange: 0.5 },
  { id: 2, resourceType: 'slope', lifecycle: 'streamable', path: 'b/b_slope.webp' },
  { id: 3, resourceType: 'slope', lifecycle: 'streamable', path: 'c/c_slope.webp', slopeRange: 0.3 }
]

const rowsAllDeclared: IResource[] = [
  { id: 1, resourceType: 'slope', lifecycle: 'streamable', path: 'a/a_slope.webp', slopeRange: 0.5 },
  { id: 2, resourceType: 'slope', lifecycle: 'streamable', path: 'b/b_slope.webp', slopeRange: 1 },
  { id: 3, resourceType: 'slope', lifecycle: 'streamable', path: 'c/c_slope.webp', slopeRange: 0.25 }
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

describe('resolveSlopeRanges', () => {
  const jobs = [{ slopePath: 'a/a_slope.webp' }, { slopePath: 'b/b_slope.webp' }, { slopePath: 'c/c_slope.webp' }]

  it('возвращает диапазоны всех карт, когда поле объявлено у каждой', () => {
    const result = resolveSlopeRanges(jobs, rowsAllDeclared)
    expect(result.size).toBe(3)
    expect(result.get('a/a_slope.webp')).toBe(0.5)
    expect(result.get('b/b_slope.webp')).toBe(1)
    expect(result.get('c/c_slope.webp')).toBe(0.25)
  })

  it('падает, если хотя бы у одной карты нет slopeRange — ни один файл ещё не записан', () => {
    expect(() => resolveSlopeRanges(jobs, rows)).toThrow(/b_slope\.webp.*recommend/s)
  })
})
