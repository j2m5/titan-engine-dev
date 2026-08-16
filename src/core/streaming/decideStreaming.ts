import type { MapCandidate, StreamDecision } from '@/core/streaming/types'
import { MAP_TYPE_RANK } from '@/core/streaming/types'
import { textureBytes } from '@/core/streaming/TextureBudget'

/**
 * Оценка веса ещё ни разу не загруженной текстуры — как у 8K.
 *
 * Завышенная намеренно: недооценка переполняет бюджет, а переоценка лишь
 * откладывает загрузку до первого измерения. В солнечной системе большинство
 * карт как раз 8K.
 */
const ASSUMED_TEXTURE_BYTES: number = textureBytes(8192, 4096)

/**
 * Решает, что держать в видеопамяти. Чистая функция: ни three.js, ни ORM,
 * ни промисов — поэтому проверяется таблично.
 *
 * Единица бюджета — карта (`MapCandidate`), не тело: один streamable-ресурс
 * одного видимого тела. Бюджет наполняется ЖАДНО в лексикографическом
 * порядке `(typeRank asc, actorPriority desc)`: старшие слои (рельеф)
 * ПРЕДЛАГАЮТСЯ бюджету раньше младших (косметика) — но это не строгая
 * послойность. Гарантия слабее: карта младшего слоя МОЖЕТ занять остаток, в
 * который не влезла более крупная карта старшего слоя, обогнавшая её по
 * порядку предложения. Решение намеренное — заполненный бюджет ценнее
 * пустого остатка: если бы непоместившийся гигантский диффуз одного тела
 * блокировал вообще все младшие слои ВСЕХ тел до себя, сцена держала бы
 * пустой остаток бюджета вместо рельефа других тел. Пример: диффуз тела Б
 * (1000 байт) не влез в остаток — slope того же тела (10 байт) всё равно
 * загрузится, если влезает (см. тест «жадный остаток»).
 *
 * Кандидаты сначала дедуплицируются по `path`: несколько тел могут делить
 * один файл (детейл-набор терраформа делят десятки тел). Дублирующие записи
 * сливаются в одну — стоимость общего пути учитывается один раз, а не за
 * каждое тело, которое на него ссылается. Слияние берёт минимальный `typeRank`
 * и максимальный `actorPriority` среди дублей: путь так же значим и приоритетен,
 * как самый значимый и приоритетный кандидат на него.
 *
 * Пол — не одна карта, а пара: диффуз и slope тела с максимальным
 * `actorPriority` допускаются безусловно, даже если их сумма дороже всего
 * бюджета. Без пола тело, которое пользователь разглядывает, оставалось бы
 * плоской заглушкой без рельефа, а из-за слепой первой оценки веса ещё и
 * мигало бы: грузится, замер вскрывает перерасход, следующий пересчёт
 * вытесняет, на возврате оценка снова слепая. Пол меняет бесконечный цикл на
 * однократный ограниченный перерасход. Если у топ-тела нет slope-кандидата,
 * пол — только диффуз: не тащить в набор чужой slope только потому, что он
 * дешёвый и рядом влезает.
 *
 * Три множества отвечают на разные вопросы про путь: `loadedPaths` — занимает
 * ли бюджет, `isPinned` — можно ли забрать, `excludedPaths` — стоит ли
 * просить. Путь с загрузкой в полёте попадает и в `loadedPaths`, и в
 * `isPinned`: байты уже обещаны.
 *
 * `load` сохраняет порядок `ranked` — `(typeRank asc, actorPriority desc)`.
 * `evict` идёт в зеркальном порядке — `(typeRank desc, actorPriority asc)`,
 * то есть младшие слои дальних тел вытесняются первыми: это буквально
 * реверс `ranked`, а не отдельная сортировка.
 *
 * Проход по `ranked` один, и счётчик `used` один. Для каждого кандидата: не
 * влезает в оставшийся бюджет (и это не пол) — не попадает никуда; влезает —
 * попадает в `wantedPaths`; влезает и не исключён — попадает ещё и в
 * `reservedPaths` и резервирует место. Исключённый в `used` не пишет, иначе
 * блокировал бы бюджет для того, кто загрузится вместо него. Отсюда
 * `reservedPaths ⊆ wantedPaths` структурно.
 *
 * Инвариант `wantedPaths ∩ evict = ∅` верен только при `loadedPaths ∩
 * excludedPaths = ∅`. Поддерживать это обязан вызывающий код; здесь
 * предпосылка проверяется лишь в деве, за `import.meta.env.DEV` — в проде
 * Vite вырезает ветку.
 */
export function decideStreaming(
  candidates: MapCandidate[],
  loadedPaths: ReadonlySet<string>,
  isPinned: (path: string) => boolean,
  excludedPaths: ReadonlySet<string>,
  sizeOf: (path: string) => number | undefined,
  budgetBytes: number
): StreamDecision {
  // Канарейка только для дева: нарушение предпосылки `loadedPaths ∩
  // excludedPaths = ∅` не бросает и не меняет результат — только
  // предупреждает, что `wantedPaths ∩ evict = ∅` для пересекающихся путей
  // больше не гарантирован.
  if (import.meta.env.DEV && [...loadedPaths].some((path: string): boolean => excludedPaths.has(path))) {
    console.warn('decideStreaming: loadedPaths ∩ excludedPaths ≠ ∅ — для общих путей wantedPaths ∩ evict может быть непустым')
  }

  const deduped: Map<string, MapCandidate> = new Map()

  for (const candidate of candidates) {
    const existing: MapCandidate | undefined = deduped.get(candidate.path)

    if (!existing) {
      deduped.set(candidate.path, candidate)
      continue
    }

    // Путь делят несколько тел — сливаем в одну запись: стоимость общего
    // файла учитывается один раз, значимостью и приоритетом путь наследует
    // самого значимого и приоритетного из своих владельцев.
    const winner: MapCandidate = candidate.actorPriority > existing.actorPriority ? candidate : existing

    deduped.set(candidate.path, {
      actorId: winner.actorId,
      name: winner.name,
      path: candidate.path,
      typeRank: Math.min(existing.typeRank, candidate.typeRank),
      actorPriority: Math.max(existing.actorPriority, candidate.actorPriority)
    })
  }

  const ranked: MapCandidate[] = [...deduped.values()].sort(
    (a: MapCandidate, b: MapCandidate): number => a.typeRank - b.typeRank || b.actorPriority - a.actorPriority
  )

  // Топ-тело — то, чей actorPriority максимален среди всех дедуплицированных
  // карт. Пол берёт его диффуз и, если есть, slope — по конкретным рангам
  // MAP_TYPE_RANK, а не «два первых слоя» (иначе при отсутствии диффуза пол
  // подменился бы двумя косметическими картами).
  const topActorPriority: number = ranked.reduce(
    (max: number, c: MapCandidate): number => Math.max(max, c.actorPriority),
    -Infinity
  )
  const floorDiffuse: MapCandidate | undefined = ranked.find(
    (c: MapCandidate): boolean => c.actorPriority === topActorPriority && c.typeRank === MAP_TYPE_RANK.diffuse
  )
  const floorSlope: MapCandidate | undefined = ranked.find(
    (c: MapCandidate): boolean => c.actorPriority === topActorPriority && c.typeRank === MAP_TYPE_RANK.slope
  )
  const floorPaths: ReadonlySet<string> = new Set([floorDiffuse?.path, floorSlope?.path].filter(Boolean) as string[])

  const reservedPaths: Set<string> = new Set()
  const wantedPaths: Set<string> = new Set()
  let used: number = 0

  for (const candidate of ranked) {
    const cost: number = sizeOf(candidate.path) ?? ASSUMED_TEXTURE_BYTES

    // Пол: диффуз и slope самого приоритетного тела допускаются всегда, даже
    // если их сумма дороже всего бюджета (Харон, Дисномия, 16K-Уран).
    // Обоснование — в докблоке функции.
    const isFloor: boolean = floorPaths.has(candidate.path)

    if (!isFloor && used + cost > budgetBytes) continue

    wantedPaths.add(candidate.path)

    // Исключённый не резервирует бюджет: он не будет загружен, значит не
    // должен занимать место следующего по приоритету. В `wantedPaths` он уже
    // попал выше.
    if (excludedPaths.has(candidate.path)) continue

    used += cost
    reservedPaths.add(candidate.path)
  }

  const load: MapCandidate[] = ranked.filter(
    (candidate: MapCandidate): boolean =>
      reservedPaths.has(candidate.path) && !loadedPaths.has(candidate.path) && !excludedPaths.has(candidate.path)
  )

  const evict: MapCandidate[] = [...ranked]
    .reverse()
    .filter(
      (candidate: MapCandidate): boolean =>
        loadedPaths.has(candidate.path) && !reservedPaths.has(candidate.path) && !isPinned(candidate.path)
    )

  return { load, evict, wantedPaths }
}
