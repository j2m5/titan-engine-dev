/**
 * Во сколько обходится путь, размер которого ещё неизвестен (не загружен либо
 * в полёте): столько же, сколько самая большая реальная карта — 8192×4096
 * текселей по два байта. Наверх, а не в среднее: недооценка неизмеренного
 * пути и есть способ пробить бюджет, который он же и должен держать. Тот же
 * приём, что ASSUMED_TEXTURE_BYTES у стримера текстур.
 */
const ASSUMED_HEIGHT_MAP_BYTES: number = 8192 * 4096 * 2

/** Тело-претендент: путь его карты высот и угловой приоритет (радиус/дистанция). */
export type HeightMapCandidate = {
  path: string
  actorPriority: number
}

export type HeightMapGateDecision = {
  request: string[]
  release: string[]
}

/**
 * Чистая политика гейта: кто должен приехать и кого пора отпустить.
 *
 * Два порога вместо одного — гистерезис: на границе одного порога тело,
 * дрожащее вокруг него по дистанции, качало бы 64 МиБ туда-обратно каждые
 * полсекунды. Между порогами решение — «ничего не менять», поэтому карта,
 * приехавшая на 32 px, живёт до 16 px.
 *
 * Обе границы включающие: `>= loadThreshold` грузим, `< releaseThreshold`
 * отпускаем.
 *
 * Путь без кандидата (тело ушло из наблюдения совсем) отпускается как
 * сирота — иначе он завис бы в реестре навсегда, никем не упомянутый;
 * тот же приём, что `evictOrphanedPaths` у ResourceObserver.
 *
 * Дубли пути схлопываются по максимуму приоритета: путь так же значим, как
 * его ближайший владелец.
 *
 * Про путь в полёте политика не знает и знать не должна — она может назвать
 * его в `release`, а реестр такой вызов проигнорирует (пин в
 * HeightFieldStorage.release). Отпустится на следующем пересчёте.
 */
export function decideHeightMaps(
  candidates: readonly HeightMapCandidate[],
  held: readonly string[],
  loadThreshold: number,
  releaseThreshold: number,
  sizeOf: (path: string) => number | undefined,
  budgetBytes: number
): HeightMapGateDecision {
  const priorityByPath: Map<string, number> = new Map()

  for (const candidate of candidates) {
    const existing: number | undefined = priorityByPath.get(candidate.path)

    if (existing === undefined || candidate.actorPriority > existing) {
      priorityByPath.set(candidate.path, candidate.actorPriority)
    }
  }

  const heldSet: Set<string> = new Set(held)

  // Претенденты на резидентность — и гистерезис записан ОДИН раз: новый путь
  // входит по верхнему порогу, уже удерживаемый держится по нижнему. Сирота
  // (путь без кандидата) в претенденты не попадает вовсе и потому отпускается.
  const contenders: [string, number][] = [...priorityByPath]
    .filter(([path, priority]) => priority >= (heldSet.has(path) ? releaseThreshold : loadThreshold))
    .sort((a, b) => b[1] - a[1])

  const admitted: Set<string> = new Set()
  let used: number = 0

  for (const [index, [path]] of contenders.entries()) {
    const cost: number = sizeOf(path) ?? ASSUMED_HEIGHT_MAP_BYTES

    // Пол: самый приоритетный претендент резидентен всегда, даже если один
    // дороже всего бюджета. Иначе тело, к которому подлетели, осталось бы без
    // рельефа именно потому, что его карта самая большая — тот же приём, что
    // floorPaths у стримера текстур (decideStreaming).
    if (index > 0 && used + cost > budgetBytes) continue

    admitted.add(path)
    used += cost
  }

  const request: string[] = [...admitted].filter((path: string): boolean => !heldSet.has(path))
  const release: string[] = [...heldSet].filter((path: string): boolean => !admitted.has(path))

  return { request, release }
}
