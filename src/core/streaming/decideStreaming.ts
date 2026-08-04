import type { StreamCandidate, StreamDecision } from '@/core/streaming/types'
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
 * Кандидаты сортируются по приоритету (угловой размер, см. `StreamCandidate`),
 * и набираются сверху, пока сумма весов влезает в бюджет. Всё, что в набор не
 * попало, но загружено, идёт на вытеснение.
 *
 * Самый приоритетный кандидат попадает в набор безусловно, даже если он один
 * дороже всего бюджета (пол `isFloor`). Без пола тело, которое пользователь
 * разглядывает, оставалось бы с вечной заглушкой, а из-за слепой первой оценки
 * ещё и мигало бы: грузится, замер вскрывает перерасход, следующий пересчёт
 * вытесняет, на возврате оценка снова слепая. Пол меняет бесконечный цикл на
 * однократный ограниченный перерасход.
 *
 * Три множества отвечают на разные вопросы: `loaded` — занимает ли бюджет,
 * `isPinned` — можно ли забрать, `excluded` — стоит ли просить. Актор с
 * загрузкой в полёте попадает и в `loaded`, и в `isPinned`: байты уже обещаны.
 *
 * `load` и `evict` сохраняют порядок `ranked` по убыванию приоритета — это
 * гарантия, а не побочный эффект: оба фильтруют один отсортированный массив.
 *
 * Проход по `ranked` один, и счётчик `used` один. Для каждого кандидата: не
 * влезает в оставшийся бюджет — не попадает никуда; влезает — попадает в
 * `wanted`; влезает и не исключён — попадает ещё и в `reserved` и резервирует
 * место. Исключённый в `used` не пишет, иначе блокировал бы бюджет для того,
 * кто загрузится вместо него. Отсюда `reserved ⊆ wanted` структурно.
 *
 * Инвариант `wanted ∩ evict = ∅` верен только при `loaded ∩ excluded = ∅`.
 * Поддерживать это обязан вызывающий код; здесь предпосылка проверяется лишь
 * в деве, за `import.meta.env.DEV` — в проде Vite вырезает ветку.
 */
export function decideStreaming(
  candidates: StreamCandidate[],
  loaded: ReadonlySet<number>,
  isPinned: (actorId: number) => boolean,
  excluded: ReadonlySet<number>,
  sizeOf: (path: string) => number | undefined,
  budgetBytes: number
): StreamDecision {
  // Канарейка только для дева: нарушение предпосылки `loaded ∩ excluded = ∅`
  // не бросает и не меняет результат — только предупреждает, что
  // `wanted ∩ evict = ∅` для пересекающихся actorId больше не гарантирован.
  if (import.meta.env.DEV && [...loaded].some((actorId: number): boolean => excluded.has(actorId))) {
    console.warn('decideStreaming: loaded ∩ excluded ≠ ∅ — для общих actorId wanted ∩ evict может быть непустым')
  }

  const ranked: StreamCandidate[] = [...candidates].sort(
    (a: StreamCandidate, b: StreamCandidate): number => b.priority - a.priority
  )

  const reserved: Set<number> = new Set()
  const wanted: Set<number> = new Set()
  let used: number = 0

  for (const [index, candidate] of ranked.entries()) {
    const cost: number = candidate.paths.reduce(
      (sum: number, path: string): number => sum + (sizeOf(path) ?? ASSUMED_TEXTURE_BYTES),
      0
    )

    // Пол: самый приоритетный кандидат допускается всегда, даже если один
    // дороже всего бюджета (Харон, Дисномия, 16K-Уран). Обоснование — в
    // докблоке функции
    const isFloor: boolean = index === 0

    if (!isFloor && used + cost > budgetBytes) continue

    wanted.add(candidate.actorId)

    // Исключённый не резервирует бюджет: он не будет загружен, значит не должен
    // занимать место следующего по приоритету. В `wanted` он уже попал выше
    if (excluded.has(candidate.actorId)) continue

    used += cost
    reserved.add(candidate.actorId)
  }

  const load: StreamCandidate[] = ranked.filter(
    (candidate: StreamCandidate): boolean =>
      reserved.has(candidate.actorId) && !loaded.has(candidate.actorId) && !excluded.has(candidate.actorId)
  )

  const evict: StreamCandidate[] = ranked.filter(
    (candidate: StreamCandidate): boolean =>
      loaded.has(candidate.actorId) && !reserved.has(candidate.actorId) && !isPinned(candidate.actorId)
  )

  return { load, evict, wanted }
}
