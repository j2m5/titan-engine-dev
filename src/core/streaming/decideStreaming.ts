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
 * Три множества разделены, потому что отвечают на разные вопросы:
 * `loaded` — занимает ли бюджет, `isPinned` — можно ли забрать,
 * `excluded` — стоит ли просить. Актор с загрузкой в полёте передаётся и в
 * `loaded`, и в `isPinned`: байты уже обещаны, и отнимать их посреди загрузки
 * нельзя.
 *
 * И `load`, и `evict` сохраняют порядок `ranked` — по убыванию приоритета:
 * оба получены фильтрацией одного и того же отсортированного массива.
 * Гарантия, а не случайность побочного эффекта: вызывающий код может, скажем,
 * вытеснять по одному, начиная с наименее приоритетного, не пересортировывая.
 *
 * Внутри — ДВА независимых прохода по одному и тому же `ranked`, с разными
 * ответами на вопрос «резервирует ли исключённый кандидат бюджет»:
 *
 * - `reserved` резервирует место, ПРОПУСКАЯ исключённых — иначе провалившийся
 *   актор блокировал бы бюджет для менее приоритетных соседей, хотя сам
 *   грузиться не будет (тест «исключённый актор не мешает остальным»).
 *   `reserved` — основа для `load`/`evict`, поведение не изменилось.
 * - `wanted` (третий член результата) считает того же кандидата так, будто
 *   исключения не существует: заслуживает ли он резидентности по приоритету и
 *   бюджету САМ ПО СЕБЕ. Нужен только вызывающему коду, чтобы отличить «актор
 *   всё ещё в зоне приоритета, просто временно заблокирован повтором после
 *   провала» от «актор реально покинул зону» — иначе снятие блокировки
 *   повтора происходило бы на первой же следующей перерасчёте вне зависимости
 *   от того, остался ли актор приоритетным (см. арку стриминга, Critical 2
 *   раунда ревью: `excluded` в старой единственной `wanted` гарантированно
 *   отсутствовал, и оба условия снятия блокировки были тождественно истинны).
 */
export function decideStreaming(
  candidates: StreamCandidate[],
  loaded: ReadonlySet<number>,
  isPinned: (actorId: number) => boolean,
  excluded: ReadonlySet<number>,
  sizeOf: (path: string) => number | undefined,
  budgetBytes: number
): StreamDecision {
  const ranked: StreamCandidate[] = [...candidates].sort(
    (a: StreamCandidate, b: StreamCandidate): number => b.priority - a.priority
  )

  const reserved: Set<number> = new Set()
  const wanted: Set<number> = new Set()
  let usedReserved: number = 0
  let usedWanted: number = 0

  for (const candidate of ranked) {
    const cost: number = candidate.paths.reduce(
      (sum: number, path: string): number => sum + (sizeOf(path) ?? ASSUMED_TEXTURE_BYTES),
      0
    )

    // Идеальный проход: исключение не участвует, кандидат меряется только
    // приоритетом и бюджетом.
    if (usedWanted + cost <= budgetBytes) {
      usedWanted += cost
      wanted.add(candidate.actorId)
    }

    // Исключённый не резервирует бюджет: он не будет загружен, значит не
    // должен занимать место, которое мог бы взять следующий по приоритету.
    if (excluded.has(candidate.actorId)) continue

    if (usedReserved + cost > budgetBytes) continue

    usedReserved += cost
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
