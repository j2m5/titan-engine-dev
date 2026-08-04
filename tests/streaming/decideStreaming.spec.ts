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

  it('дорогой, но не топ приоритета — пропускается (continue), а не останавливает цикл', () => {
    // Пол защищает только САМОГО приоритетного кандидата (см. тесты floor
    // ниже) — для всех остальных рангов действует обычная проверка. Актор 2
    // стоит два 8K (вдвое дороже всего бюджета) и стоит НЕ на первом месте
    // по приоритету — цикл обязан пропустить его (continue) и дойти до
    // актора 3, а не остановиться на первом же промахе (break) и не
    // применить к нему пол, как к топу.
    const decision = decideStreaming(
      [candidate(1, 0.9), candidate(2, 0.6, 'a.jpg', 'b.jpg'), candidate(3, 0.3)],
      new Set(),
      nothingPinned,
      noneExcluded,
      all8K,
      SIZE_8K * 2
    )

    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([1, 3])
  })

  it('пол: топ-кандидат дороже всего бюджета всё равно допускается', () => {
    // Харон (диффуз+bump 16K, 1366 МиБ) дороже всего бюджета (1 ГиБ) целиком —
    // без пола он не попал бы НИКУДА, и тело, на которое смотрит пользователь,
    // осталось бы с вечной заглушкой. Пол гарантирует резидентность самому
    // приоритетному кандидату независимо от его стоимости.
    const decision = decideStreaming(
      [candidate(1, 0.9, 'a.jpg', 'b.jpg', 'c.jpg')], // 3 × 8K > бюджет в 1 × 8K
      new Set(),
      nothingPinned,
      noneExcluded,
      all8K,
      SIZE_8K
    )

    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([1])
  })

  it('пол не распространяется на кандидата после дорогого топа', () => {
    // Топ уже перебрал весь бюджет (и сверх того) — следующий по приоритету
    // по-прежнему проверяется по ОСТАВШЕМУСЯ бюджету, который топ исчерпал:
    // перерасход ограничен одним телом, а не превращается в цепочку допусков.
    const decision = decideStreaming(
      [candidate(1, 0.9, 'a.jpg', 'b.jpg', 'c.jpg'), candidate(2, 0.5)],
      new Set(),
      nothingPinned,
      noneExcluded,
      all8K,
      SIZE_8K
    )

    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([1])
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

  it('wanted включает исключённого кандидата, если тот сам по себе влезает в бюджет', () => {
    // Тот же сетап, что и «исключённый актор не грузится, но и не мешает
    // остальным»: актор 1 приоритетнее и по бюджету заслуживает резидентности
    // сам по себе — исключение блокирует только ЗАГРУЗКУ (load), а не то,
    // что актор всё ещё «в зоне». Раньше единственная wanted строилась ИЗ
    // decision.load и потому НИКОГДА не содержала исключённых — отсюда и
    // Вызывающий код не мог отличить «ещё приоритетен, просто
    // заблокирован» от «покинул зону», и снимал блокировку повтора на первом
    // же цикле после провала.
    const decision = decideStreaming(
      [candidate(1, 0.9), candidate(2, 0.5)],
      new Set(),
      nothingPinned,
      new Set([1]),
      all8K,
      SIZE_8K
    )

    expect(decision.wanted.has(1)).toBe(true)
    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([2])
  })

  it('wanted включает уже загруженного кандидата, даже если его нет в load', () => {
    // Актор уже резидентен и по-прежнему влезает в бюджет — decideStreaming
    // не отдаёт его в load (незачем перезапрашивать то, что уже загружено),
    // но по приоритету/бюджету он всё ещё «wanted».
    const decision = decideStreaming([candidate(1, 0.9)], new Set([1]), nothingPinned, noneExcluded, all8K, SIZE_8K)

    expect(decision.wanted.has(1)).toBe(true)
    expect(decision.load).toEqual([])
  })

  it('load всегда подмножество wanted — даже когда исключение освобождает бюджет менее приоритетным', () => {
    // Бюджет на два слота, кандидаты 0.9 (исключён),
    // 0.5, 0.1. Раньше wanted и load считались ДВУМЯ раздельными проходами —
    // wanted заряжал бюджет исключённому кандидату целиком (усекая место для
    // менее приоритетных), а проход для load пропускал резервирование
    // исключённому вовсе (тест выше). Из-за этого load мог получить актора
    // 3 (0.1), а wanted — нет: load=[2,3], wanted={1,2}. Если бы актор 3
    // потом провалился, attempted снялся бы на первом же цикле — тот самый
    // бесконечный ретрай.
    const decision = decideStreaming(
      [candidate(1, 0.9), candidate(2, 0.5), candidate(3, 0.1)],
      new Set(),
      nothingPinned,
      new Set([1]),
      all8K,
      SIZE_8K * 2
    )

    for (const candidate of decision.load) {
      expect(decision.wanted.has(candidate.actorId)).toBe(true)
    }

    // Явная фиксация формы: если это когда-нибудь перестанет быть [2, 3],
    // сам факт "подмножество" мог бы устоять случайно (пустой load тоже
    // подмножество). Проверяем, что тест действительно нагружает механизм.
    expect(decision.load.map((c: StreamCandidate): number => c.actorId)).toEqual([2, 3])
  })

  it('wanted и evict не пересекаются, пока loaded и excluded не пересекаются', () => {
    // Реальный вызывающий код (ResourceObserver) поддерживает
    // attempted ∩ loaded = ∅ как инвариант: провал синхронно убирает актора
    // из loaded в момент, когда добавляет его в attempted (=excluded здесь).
    // При этом условии ни один актор не может одновременно "заслуживать
    // резидентности" (wanted) и "подлежать вытеснению" (evict) — иначе это
    // было бы логическим противоречием в самих именах множеств.
    const loaded = new Set([2, 3])
    const excluded = new Set([4]) // не пересекается с loaded

    const decision = decideStreaming(
      [candidate(1, 0.9), candidate(2, 0.6), candidate(3, 0.3), candidate(4, 0.1)],
      loaded,
      nothingPinned,
      excluded,
      all8K,
      SIZE_8K * 2 // впритык на двоих — кто-то из loaded окажется вытеснен
    )

    const overlap = [...decision.wanted].filter((actorId: number): boolean =>
      decision.evict.some((c: StreamCandidate): boolean => c.actorId === actorId)
    )

    expect(overlap).toEqual([])
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
