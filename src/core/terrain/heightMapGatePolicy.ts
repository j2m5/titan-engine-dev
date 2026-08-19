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
  releaseThreshold: number
): HeightMapGateDecision {
  const priorityByPath: Map<string, number> = new Map()

  for (const candidate of candidates) {
    const existing: number | undefined = priorityByPath.get(candidate.path)

    if (existing === undefined || candidate.actorPriority > existing) {
      priorityByPath.set(candidate.path, candidate.actorPriority)
    }
  }

  const heldSet: Set<string> = new Set(held)
  const request: string[] = []

  for (const [path, priority] of priorityByPath) {
    if (priority >= loadThreshold && !heldSet.has(path)) request.push(path)
  }

  const release: string[] = []

  for (const path of heldSet) {
    const priority: number | undefined = priorityByPath.get(path)

    if (priority === undefined || priority < releaseThreshold) release.push(path)
  }

  return { request, release }
}
