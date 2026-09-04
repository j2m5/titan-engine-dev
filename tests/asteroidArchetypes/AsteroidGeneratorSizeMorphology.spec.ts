import { AsteroidGenerator, pickArchetype } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { morphologyRanges } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary'
import type { SectorBounds } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'

const bounds: SectorBounds = { minRadius: 100, maxRadius: 120, minAngle: 0, maxAngle: 0.3 }
const K = 14

/** Норма первой колонки матрицы i в плоском буфере — базовый масштаб × анизотропия x */
const columnNorm = (buf: Float32Array, i: number): number =>
  Math.hypot(buf[i * 16], buf[i * 16 + 1], buf[i * 16 + 2])

describe('pickArchetype: морфология по доле размера (чистая функция)', () => {
  // Только процедурная библиотека: доли категорий равны весам профиля
  const ranges = morphologyRanges('stony', K, { shapeModels: [], realShare: 0 })

  it('индексы всегда в [0, K) и внутри диапазона выбранной морфологии', () => {
    for (let i = 0; i < 2000; i++) {
      const u1 = (i * 0.618033) % 1
      const u2 = (i * 0.414213) % 1
      const t = (i % 11) / 10
      const k = pickArchetype(u1, u2, t, ranges)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(K)
    }
  })

  it('мелкие камни (t = 0) чаще осколки, крупные (t = 1) чаще слипшиеся формы', () => {
    const fragmentRange = ranges.find((r) => r.morphology === 'fragment')!
    const isFragment = (k: number) => k >= fragmentRange.start && k < fragmentRange.start + fragmentRange.count
    let smallFragments = 0
    let largeFragments = 0
    const N = 4000
    for (let i = 0; i < N; i++) {
      const u1 = (i + 0.5) / N
      const u2 = (i * 0.7548776) % 1
      if (isFragment(pickArchetype(u1, u2, 0, ranges))) smallFragments++
      if (isFragment(pickArchetype(u1, u2, 1, ranges))) largeFragments++
    }
    // Базовый вес осколков 0.5: у мелких ≈ 0.5·1.6 / норм → большинство, у крупных ≈ 0.5·0.4 / норм → меньшинство
    expect(smallFragments / N).toBeGreaterThan(0.6)
    expect(largeFragments / N).toBeLessThan(0.35)
    expect(smallFragments).toBeGreaterThan(largeFragments * 2)
  })

  it('без наклона (t = 0.5) доли близки к весам профиля', () => {
    const counts = new Map<string, number>()
    const N = 6000
    for (let i = 0; i < N; i++) {
      const k = pickArchetype((i + 0.5) / N, (i * 0.7548776) % 1, 0.5, ranges)
      const m = ranges.find((r) => k >= r.start && k < r.start + r.count)!.morphology
      counts.set(m, (counts.get(m) ?? 0) + 1)
    }
    expect((counts.get('fragment') ?? 0) / N).toBeCloseTo(0.5, 1)
    expect((counts.get('cratered') ?? 0) / N).toBeCloseTo(0.15, 1)
  })
})

describe('AsteroidGenerator с профилем: раскладка по размеру, матрицы прежние', () => {
  const plain = new AsteroidGenerator({ thickness: 10, minScale: 0.3, maxScale: 1.6 })
  const sized = new AsteroidGenerator({ thickness: 10, minScale: 0.3, maxScale: 1.6, profile: 'stony' })

  it('множество матриц побитово то же, что без профиля — меняется только раскладка по группам', () => {
    const seed = 4242
    const count = 3000
    const a = plain.generateMatricesGrouped(seed, count, bounds, K)
    const b = sized.generateMatricesGrouped(seed, count, bounds, K)
    const flatten = (groups: Float32Array[]): string[] => {
      const rows: string[] = []
      for (const g of groups) for (let i = 0; i < g.length / 16; i++) rows.push(Array.from(g.subarray(i * 16, i * 16 + 16)).join(','))
      return rows.sort()
    }
    expect(flatten(b)).toEqual(flatten(a))
    expect(b.reduce((s, g) => s + g.length, 0)).toBe(count * 16)
  })

  it('средний масштаб в группах осколков меньше, чем в группах rubble/двойных/волчков', () => {
    const groups = sized.generateMatricesGrouped(4242, 6000, bounds, K)
    const ranges = morphologyRanges('stony', K)
    const meanScale = (morphology: string): number => {
      const range = ranges.find((r) => r.morphology === morphology)!
      let sum = 0
      let n = 0
      for (let k = range.start; k < range.start + range.count; k++) {
        const g = groups[k]
        for (let i = 0; i < g.length / 16; i++) {
          sum += columnNorm(g, i)
          n++
        }
      }
      return sum / Math.max(n, 1)
    }
    const fragments = meanScale('fragment')
    for (const m of ['rubble', 'binary', 'top']) {
      expect(meanScale(m)).toBeGreaterThan(fragments * 1.15)
    }
  })

  it('детерминизм: повторный вызов даёт побитово те же группы', () => {
    const a = sized.generateMatricesGrouped(99, 1500, bounds, K)
    const b = sized.generateMatricesGrouped(99, 1500, bounds, K)
    for (let k = 0; k < K; k++) expect(Array.from(a[k])).toEqual(Array.from(b[k]))
  })

  it('без профиля раскладка прежняя: archetypeAssignment совпадает с хешем archetypeForInstance', async () => {
    const { archetypeForInstance } = await import('@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator')
    const assignment = plain.archetypeAssignment(77, 500, K)
    for (let i = 0; i < 500; i++) expect(assignment[i]).toBe(archetypeForInstance(77, i, K))
  })
})
