import { describe, it, expect } from 'vitest'
import { decideStreaming } from '@/core/streaming/decideStreaming'
import { textureBytes } from '@/core/streaming/TextureBudget'
import type { StreamCandidate } from '@/core/streaming/types'

const SIZE_8K: number = textureBytes(8192, 4096) // ~171 МиБ
const SIZE_2K: number = textureBytes(2048, 1024) // ~11 МиБ

function candidate(actorId: number, priority: number, ...paths: string[]): StreamCandidate {
  return { actorId, name: `actor-${actorId}`, priority, paths: paths.length ? paths : [`p${actorId}.jpg`] }
}

/** Все пути весят как 8K. */
const all8K = (): number => SIZE_8K

const nothingPinned = (): boolean => false
const noneExcluded: ReadonlySet<number> = new Set()

describe('decideStreaming', () => {
  it('набирает по убыванию приоритета, пока влезает в бюджет', () => {
    const decision = decideStreaming(
      [candidate(1, 0.1), candidate(2, 0.5), candidate(3, 0.3)],
      new Set(),
      nothingPinned,
      noneExcluded,
      all8K,
      SIZE_8K * 2
    )

    // Два самых приоритетных: 2 (0.5) и 3 (0.3). Актор 1 не влезает.
    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([2, 3])
    expect(decision.evict).toEqual([])
  })

  it('вытесняет загруженное, что не попало в бюджет', () => {
    const decision = decideStreaming(
      [candidate(1, 0.1), candidate(2, 0.5)],
      new Set([1, 2]),
      nothingPinned,
      noneExcluded,
      all8K,
      SIZE_8K
    )

    expect(decision.load).toEqual([])
    expect(decision.evict.map((c: StreamCandidate): number => c.actorId)).toEqual([1])
  })

  it('крупное далёкое тело обходит мелкое близкое', () => {
    // Камера у Мимаса, 1000 км от него. Приоритет = радиус / дистанция.
    // Мимас 198.8 / 1 000 = 0.199; Сатурн 58 232 / 185 540 = 0.314.
    const mimas = candidate(1, 198.8 / 1000)
    const saturn = candidate(2, 58232 / 185540)

    const decision = decideStreaming([mimas, saturn], new Set(), nothingPinned, noneExcluded, all8K, SIZE_8K)

    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([2])
  })

  it('стоимость актора — сумма его путей', () => {
    const decision = decideStreaming(
      [candidate(1, 0.9, 'a.jpg', 'b.jpg'), candidate(2, 0.5)],
      new Set(),
      nothingPinned,
      noneExcluded,
      all8K,
      SIZE_8K * 2
    )

    // Актор 1 стоит два 8K и выбирает весь бюджет — актору 2 места нет.
    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([1])
  })

  it('неизвестный размер берётся по оценке, а не как ноль', () => {
    const decision = decideStreaming(
      [candidate(1, 0.9), candidate(2, 0.5), candidate(3, 0.1)],
      new Set(),
      nothingPinned,
      noneExcluded,
      (): number | undefined => undefined,
      SIZE_8K * 2
    )

    // Оценка равна 8K, значит влезают ровно двое. Считай мы неизвестное нулём —
    // влезли бы все трое и бюджет был бы превышен втрое.
    expect(decision.load).toHaveLength(2)
  })

  it('закреплённый актор не вытесняется', () => {
    const decision = decideStreaming(
      [candidate(1, 0.1), candidate(2, 0.5)],
      new Set([1, 2]),
      (actorId: number): boolean => actorId === 1,
      noneExcluded,
      all8K,
      SIZE_8K
    )

    expect(decision.evict).toEqual([])
  })

  it('исключённый актор не грузится, но и не мешает остальным', () => {
    // Бюджет ровно на одного. Исключённый актор 1 приоритетнее — если бы он
    // резервировал бюджет перед тем, как его отфильтруют, актору 2 места
    // бы не хватило. Ключевая проверка не "не загрузился", а "не заблокировал".
    const decision = decideStreaming(
      [candidate(1, 0.9), candidate(2, 0.5)],
      new Set(),
      nothingPinned,
      new Set([1]),
      all8K,
      SIZE_8K
    )

    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([2])
  })

  it('уже загруженный не запрашивается повторно', () => {
    const decision = decideStreaming(
      [candidate(1, 0.9)],
      new Set([1]),
      nothingPinned,
      noneExcluded,
      all8K,
      SIZE_8K
    )

    expect(decision.load).toEqual([])
    expect(decision.evict).toEqual([])
  })

  it('слишком дорогой не влезает — цикл продолжает, а не останавливается', () => {
    // Актор 1 приоритетнее, но стоит два 8K и не влезает в бюджет на один.
    // Актор 2 дешевле и влезает — цикл обязан пропустить первого и дойти
    // до второго (continue), а не остановиться на первом же промахе (break).
    const sizeOf = (path: string): number => (path === 'p2.jpg' ? SIZE_2K : SIZE_8K)

    const decision = decideStreaming(
      [candidate(1, 0.9, 'a.jpg', 'b.jpg'), candidate(2, 0.5)],
      new Set(),
      nothingPinned,
      noneExcluded,
      sizeOf,
      SIZE_8K
    )

    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([2])
  })

  it('вытесняет несколько тел в порядке убывания приоритета', () => {
    const decision = decideStreaming(
      [candidate(1, 0.2), candidate(2, 0.6), candidate(3, 0.9)],
      new Set([1, 2, 3]),
      nothingPinned,
      noneExcluded,
      all8K,
      SIZE_8K
    )

    // Влезает только актор 3. Вытесняются 2 и 1 — в порядке убывания
    // приоритета, том же, в котором отдаётся load.
    expect(decision.evict.map((c: StreamCandidate): number => c.actorId)).toEqual([2, 1])
  })

  it('текстуры разного веса делят бюджет по-разному', () => {
    const sizeOf = (path: string): number => (path === 'p1.jpg' ? SIZE_2K : SIZE_8K)

    const decision = decideStreaming(
      [candidate(1, 0.9), candidate(2, 0.5)],
      new Set(),
      nothingPinned,
      noneExcluded,
      sizeOf,
      SIZE_8K + SIZE_2K
    )

    // Лёгкий и тяжёлый вместе влезают ровно.
    expect(decision.load).toHaveLength(2)
  })
})
