import { describe, it, expect } from 'vitest'
import { decideStreaming } from '@/core/streaming/decideStreaming'
import { textureBytes } from '@/core/streaming/TextureBudget'
import { MAP_TYPE_RANK } from '@/core/streaming/types'
import type { MapCandidate } from '@/core/streaming/types'

const SIZE_8K: number = textureBytes(8192, 4096) // ~171 МиБ

/** Кандидат-карта: рангов и приоритетов достаточно, чтобы не тащить three.js в юнит. */
function mc(actorId: number, path: string, typeRank: number, actorPriority: number): MapCandidate {
  return { actorId, name: `a${actorId}`, path, typeRank, actorPriority }
}

/** Все пути весят одинаково n байт. */
const size =
  (n: number) =>
  (): number =>
    n

const nothingPinned = (): boolean => false
const noneExcluded: ReadonlySet<string> = new Set()

describe('decideStreaming', () => {
  it('послойность: detail не в наборе, пока диффуз дальнего тела не влез', () => {
    // Бюджет на 3 карты по 100: диффуз A(prio 2), диффуз B(prio 1), detail A(rank 2).
    // Пол забирает диффуз A (топ-тело) безусловно, детейл того же тела всё равно
    // не должен обогнать диффуз ДРУГОГО тела — послойность важнее актор-приоритета.
    const d = decideStreaming(
      [mc(1, 'a.diff', 0, 2), mc(2, 'b.diff', 0, 1), mc(1, 'a.detail', 2, 2)],
      new Set(),
      nothingPinned,
      noneExcluded,
      size(100),
      250
    )

    expect(d.load.map((c: MapCandidate): string => c.path)).toEqual(['a.diff', 'b.diff'])
  })

  it('внутри слоя — по актор-приоритету', () => {
    // Три диффуза одного слоя, бюджет на два: побеждают два больших приоритета.
    const d = decideStreaming(
      [mc(1, 'a.diff', 0, 1), mc(2, 'b.diff', 0, 5), mc(3, 'c.diff', 0, 3)],
      new Set(),
      nothingPinned,
      noneExcluded,
      size(100),
      200
    )

    expect(d.load.map((c: MapCandidate): string => c.path)).toEqual(['b.diff', 'c.diff'])
  })

  it('зеркальное вытеснение: загруженный detail дальнего уходит первым', () => {
    // a.diff (prio 5) — топ-тело, держит пол. b.diff и b.detail (prio 3) уже
    // загружены, но бюджет тесный — влезает только пол. Внутри вытесняемого
    // тела b детейл (младший слой) обязан уйти раньше диффуза того же тела.
    const loadedPaths: ReadonlySet<string> = new Set(['a.diff', 'b.diff', 'b.detail'])

    const d = decideStreaming(
      [mc(1, 'a.diff', 0, 5), mc(2, 'b.diff', 0, 3), mc(2, 'b.detail', 2, 3)],
      loadedPaths,
      nothingPinned,
      noneExcluded,
      size(100),
      150
    )

    expect(d.evict.map((c: MapCandidate): string => c.path)).toEqual(['b.detail', 'b.diff'])
  })

  it('дедуп путей: шаренный detail-путь резервирует бюджет один раз, а не за каждого владельца', () => {
    // terrain/d.webp запрошен и актором 1 (prio 5, тот же, что диффуз-пол), и
    // актором 2 (prio 3, дубль того же пути). Бюджет на 300 хватает ровно на
    // пол (a.diff, 100) + terrain/d.webp (100, ОДИН раз) + c.detail (100).
    // Если бы дедуп не сработал и путь зарезервировал бюджет ЗА КАЖДОГО из
    // двух владельцев (100+100), сумма достигла бы 300 ещё до c.detail — тот
    // не влез бы. То, что c.detail в наборе, и есть честное доказательство
    // одноразового списания, а не тавтологичная проверка Set на дубликаты.
    const d = decideStreaming(
      [
        mc(1, 'a.diff', 0, 5),
        mc(1, 'terrain/d.webp', 2, 5),
        mc(2, 'terrain/d.webp', 2, 3),
        mc(3, 'c.detail', 2, 1)
      ],
      new Set(),
      nothingPinned,
      noneExcluded,
      size(100),
      300
    )

    // Путь встречается в load ровно один раз — дубли-кандидаты схлопнулись в
    // одну запись ДО прохода, а не просто совпали числом дважды списанных.
    expect(d.load.filter((c: MapCandidate): boolean => c.path === 'terrain/d.webp')).toHaveLength(1)
    expect(d.load.map((c: MapCandidate): string => c.path)).toEqual(['a.diff', 'terrain/d.webp', 'c.detail'])
  })

  it('суб-ранг detail: бюджет на одну detail-карту — влезает именно detailNormal (гейт слоя)', () => {
    // Материал (этап 4) гейтит ВЕСЬ detail-набор по наличию detailNormal: без
    // него detailDiffuse/detailArm/detailNormal2 в бюджете мёртвы, эффекта
    // ноль. detailNormal нарочно ПОСЛЕДНИЙ в массиве кандидатов — если бы
    // суб-ранги внутри detail-слоя были равны (как раньше, все detail* = 2),
    // сортировка была бы стабильна и победителем стал бы ПЕРВЫЙ по вводу
    // (detailDiffuse), а не значимый для гейта detailNormal. Один актор —
    // общий actorPriority, так что порядок внутри слоя решает только typeRank.
    const d = decideStreaming(
      [
        mc(1, 'x.detailDiffuse', MAP_TYPE_RANK.detailDiffuse, 5),
        mc(1, 'x.detailArm', MAP_TYPE_RANK.detailArm, 5),
        mc(1, 'x.detailNormal2', MAP_TYPE_RANK.detailNormal2, 5),
        mc(1, 'x.detailNormal', MAP_TYPE_RANK.detailNormal, 5)
      ],
      new Set(),
      nothingPinned,
      noneExcluded,
      size(100),
      100 // ровно на одну карту
    )

    expect(d.load.map((c: MapCandidate): string => c.path)).toEqual(['x.detailNormal'])
  })

  it('жадный остаток: диффуз не влез — slope того же тела всё равно занимает освободившееся место', () => {
    // Ревью зафиксировало осознанное поведение (см. докблок decideStreaming):
    // бюджет наполняется ЖАДНО в порядке (typeRank asc, actorPriority desc),
    // а не строго послойно. Диффуз тела Б стоит 1000 и не влезает в остаток
    // после пола — цикл его пропускает (`continue`), НЕ останавливая набор.
    // slope того же тела Б стоит всего 10 и, дойдя до него по очереди, влезает
    // в тот же остаток — и загружается, хотя диффуз того же тела не смог.
    // Строгая послойность («младший слой не начинается, пока не влезли все
    // старшие») здесь намеренно НЕ соблюдена: заполненный бюджет ценнее
    // пустого остатка, который держала бы строгая иерархия ради тела Б.
    const sizeOf = (path: string): number => {
      if (path === 'a.diff') return 5
      if (path === 'b.diff') return 1000
      return 10 // b.slope
    }

    const d = decideStreaming(
      [mc(1, 'a.diff', 0, 10), mc(2, 'b.diff', 0, 5), mc(2, 'b.slope', 1, 5)],
      new Set(),
      nothingPinned,
      noneExcluded,
      sizeOf,
      20 // хватает на пол (5) и на b.slope (10), но не на b.diff (1000)
    )

    expect(d.load.some((c: MapCandidate): boolean => c.path === 'b.slope')).toBe(true)
    expect(d.load.some((c: MapCandidate): boolean => c.path === 'b.diff')).toBe(false)
  })

  it('пол: диффуз+slope топ-тела грузятся при бюджете меньше их суммы', () => {
    // Бюджет 50 не покрывает даже одну карту по 100 — без пола топ-тело
    // осталось бы вовсе без карт. Диффуз и slope тела 1 (prio 5) обязаны
    // попасть в набор оба, тело 2 — не попадает совсем.
    const d = decideStreaming(
      [mc(1, 'a.diff', 0, 5), mc(1, 'a.slope', 1, 5), mc(2, 'b.diff', 0, 3)],
      new Set(),
      nothingPinned,
      noneExcluded,
      size(100),
      50
    )

    expect(d.load.map((c: MapCandidate): string => c.path)).toEqual(['a.diff', 'a.slope'])
  })

  it('пол пары без slope у топ-тела — только диффуз, чужой slope не подмешивается', () => {
    // У топ-тела (актор 1) нет slope-кандидата вовсе. Пол обязан ограничиться
    // диффузом топ-тела и не хватать slope чужого тела 2, даже если тот
    // дешёвый и легко влез бы.
    const d = decideStreaming(
      [mc(1, 'a.diff', 0, 5), mc(2, 'b.diff', 0, 3), mc(2, 'b.slope', 1, 3)],
      new Set(),
      nothingPinned,
      noneExcluded,
      size(100),
      0
    )

    expect(d.load.map((c: MapCandidate): string => c.path)).toEqual(['a.diff'])
  })

  it('пины и excluded — по путям (прежняя семантика на новой грануле)', () => {
    // a.slope исключён: пол всё равно хочет его (wantedPaths), но он не
    // грузится и не резервирует бюджет. b.diff уже загружен и закреплён —
    // не должен уйти в evict, даже не попадая в reserved по бюджету.
    const loadedPaths: ReadonlySet<string> = new Set(['a.diff', 'b.diff'])
    const excludedPaths: ReadonlySet<string> = new Set(['a.slope'])

    const d = decideStreaming(
      [mc(1, 'a.diff', 0, 5), mc(1, 'a.slope', 1, 5), mc(2, 'b.diff', 0, 3)],
      loadedPaths,
      (path: string): boolean => path === 'b.diff',
      excludedPaths,
      size(100),
      100
    )

    expect(d.wantedPaths.has('a.slope')).toBe(true)
    expect(d.load.some((c: MapCandidate): boolean => c.path === 'a.slope')).toBe(false)
    expect(d.evict.some((c: MapCandidate): boolean => c.path === 'b.diff')).toBe(false)
  })

  it('детерминизм: тот же вход — тот же результат, порядок load/evict стабилен', () => {
    // Два тела делят актор-приоритет 5 (тай-брейк должен быть стабильным).
    const candidates: MapCandidate[] = [mc(1, 'a.diff', 0, 5), mc(2, 'b.diff', 0, 5), mc(1, 'a.slope', 1, 5)]
    const loadedPaths: ReadonlySet<string> = new Set(['a.diff', 'b.diff', 'a.slope'])

    const run = (): ReturnType<typeof decideStreaming> =>
      decideStreaming(candidates, loadedPaths, nothingPinned, noneExcluded, size(100), 100)

    const first = run()
    const second = run()

    expect(second.load.map((c: MapCandidate): string => c.path)).toEqual(first.load.map((c: MapCandidate): string => c.path))
    expect(second.evict.map((c: MapCandidate): string => c.path)).toEqual(
      first.evict.map((c: MapCandidate): string => c.path)
    )
  })

  it('неизвестный размер берётся по оценке 8K, а не как ноль', () => {
    // Оценка равна 8K, значит при бюджете на два 8K влезают ровно двое.
    // Считай мы неизвестное нулём — влезли бы все трое и бюджет был бы
    // превышен втрое.
    const d = decideStreaming(
      [mc(1, 'a.diff', 0, 0.9), mc(2, 'b.diff', 0, 0.5), mc(3, 'c.diff', 0, 0.1)],
      new Set(),
      nothingPinned,
      noneExcluded,
      (): undefined => undefined,
      SIZE_8K * 2
    )

    expect(d.load).toHaveLength(2)
  })
})
