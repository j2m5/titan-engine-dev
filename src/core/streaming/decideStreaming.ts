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
 * Один проход по `ranked`, ОДИН счётчик `used` — не два раздельных, как было
 * в первой версии этого фикса (round 2 ревью нашёл: раздельные счётчики
 * заряжали бюджет исключённому кандидату по-разному в `wanted` и в проходе
 * для `load`, из-за чего `load` мог содержать актора, ОТСУТСТВУЮЩЕГО в
 * `wanted` — а значит его провал снимал бы блокировку повтора на следующем
 * же цикле, ровно тот бесконечный ретрай, который Critical 2 должен был
 * починить). Теперь для каждого кандидата по порядку ранга:
 *
 * 1. Проверяется, влезает ли он в ОСТАВШИЙСЯ (после реально зарезервированных
 *    впереди) бюджет — если нет, кандидат не попадает НИКУДА: ни в `wanted`,
 *    ни тем более в `reserved`.
 * 2. Если влезает — он попадает в `wanted`: по приоритету и бюджету
 *    заслуживает резидентности, будто исключения не существует.
 * 3. Если он ДОПОЛНИТЕЛЬНО не исключён — он ТАКЖЕ попадает в `reserved` (в
 *    основу `load`/`evict`), и его стоимость реально резервирует место в
 *    `used` для менее приоритетных соседей. Исключённый в `used` не пишет —
 *    иначе блокировал бы бюджет для того, кто и так за него загрузится
 *    (тест «исключённый актор не мешает остальным»).
 *
 * Поскольку `reserved.add` возможен ТОЛЬКО следом за `wanted.add` в одной и
 * той же итерации (после общей проверки «влезает») и никогда отдельно,
 * `reserved ⊆ wanted` и, следовательно, `load ⊆ wanted` — структурно, а не
 * по совпадению чисел в конкретном тесте.
 *
 * Есть загруженный актор, для которого может быть тесно: если `loaded` и
 * `excluded` пересекаются на одном и том же actorId (актор одновременно
 * "уже резидентен" и "исключён" — комбинация, которую реальный вызывающий
 * код, `ResourceObserver`, никогда не производит: провал переводит актора в
 * `attempted` СИНХРОННО С тем, как убирает его из `loaded`, так что
 * `attempted ∩ loaded = ∅` — всегда её инвариант), — то для такого actorId
 * `wanted` и `evict` МОГУТ пересечься: актор в `wanted` (заслуживает по
 * приоритету/бюджету) и одновременно в `evict` (загружен, но не `reserved`,
 * поскольку исключён). Инвариант `wanted ∩ evict = ∅` документирован и
 * протестирован ТОЛЬКО при условии `loaded ∩ excluded = ∅` — это условие
 * вызывающий код обязан поддерживать сам, decideStreaming его не проверяет.
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
  let used: number = 0

  for (const candidate of ranked) {
    const cost: number = candidate.paths.reduce(
      (sum: number, path: string): number => sum + (sizeOf(path) ?? ASSUMED_TEXTURE_BYTES),
      0
    )

    if (used + cost > budgetBytes) continue

    wanted.add(candidate.actorId)

    // Исключённый не резервирует бюджет: он не будет загружен, значит не
    // должен занимать место, которое мог бы взять следующий по приоритету.
    // В `wanted` он уже попал строкой выше — заслуживает резидентности сам
    // по себе, просто не проходит фактическое резервирование.
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
