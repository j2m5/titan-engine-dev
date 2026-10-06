import type { IRingRenderingObject, RingMoonlet } from '@/core/models/types'

/**
 * Лунки колец: малые тела реальной формы в плоскости кольца, вокруг орбиты
 * которых кольцо расчищено щелью (как Пан в щели Энке). Здесь — данные
 * (резолвер, проблемы для валидатора БД), щели в единицах потребителя и
 * CPU-маска щели. GLSL-зеркало маски — чанк RingGap, менять синхронно.
 */

/** Слотов щелей в шейдерах (uRingGaps) — столько лунок на кольцо. */
export const RING_MOONLETS_MAX = 4

/** Мягкий край щели — доля её полуширины. */
export const RING_GAP_EDGE_FRACTION = 0.15

/** Реальные модели формы в репозитории (asteroids/shapes/<имя>_{l0,near}.bin, docs/asteroid-shape-models.md). */
export const RING_MOONLET_MODELS: readonly string[] = [
  'bennu', 'deimos', 'epimetheus', 'eros', 'gaspra', 'ida', 'itokawa', 'janus',
  'kleopatra', 'lutetia', 'mathilde', 'pandora', 'phobos', 'prometheus', 'steins', 'toutatis'
]

/** Щель в единицах потребителя: радиус орбиты, полуширина, мягкий край. */
export interface RingGap {
  radius: number
  halfWidth: number
  edge: number
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown): v is number => finite(v) && v > 0

/** Проблемы лунок и ringshineStrength в данных кольца; пусто — данные годны. Общий источник резолвера и валидатора БД. */
export function ringMoonletProblems(data: Record<string, unknown>): string[] {
  const problems: string[] = []
  const strength = data.ringshineStrength
  if (strength !== undefined && !(finite(strength) && strength >= 0)) {
    problems.push('ringshineStrength must be a non-negative number')
  }

  const moonlets = data.moonlets
  if (moonlets === undefined) return problems
  if (!Array.isArray(moonlets)) return [...problems, 'moonlets must be an array']
  if (moonlets.length > RING_MOONLETS_MAX) problems.push(`moonlets: at most ${RING_MOONLETS_MAX}, got ${moonlets.length}`)

  const inner = data.innerRadius
  const outer = data.outerRadius
  moonlets.forEach((entry: unknown, i: number) => {
    const at = `moonlets[${i}]`
    const m = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
    const r = m.radiusKm
    if (!(finite(r) && finite(inner) && finite(outer) && r >= inner && r <= outer)) {
      problems.push(`${at}.radiusKm must lie within [innerRadius, outerRadius]`)
    }
    if (!finite(m.azimuthDeg)) problems.push(`${at}.azimuthDeg must be a finite number (degrees)`)
    if (!positive(m.sizeKm)) problems.push(`${at}.sizeKm must be a positive number (kilometers)`)
    if (!positive(m.gapKm)) problems.push(`${at}.gapKm must be a positive number (kilometers)`)
    if (typeof m.model !== 'string' || !RING_MOONLET_MODELS.includes(m.model)) {
      problems.push(`${at}.model must be one of: ${RING_MOONLET_MODELS.join(', ')}`)
    }
  })
  return problems
}

function failOnProblems(data: Partial<IRingRenderingObject> | undefined, context: string): void {
  const problems = ringMoonletProblems((data ?? {}) as Record<string, unknown>)
  if (problems.length > 0) throw new Error(`[ring] ${context}: ${problems.join('; ')}`)
}

/** Лунки кольца из данных; громкая ошибка с именем кольца на битых данных. */
export function resolveRingMoonlets(data: Partial<IRingRenderingObject> | undefined, context: string): RingMoonlet[] {
  failOnProblems(data, context)
  return (data?.moonlets ?? []).map((m) => ({ ...m }))
}

/** Сила подсветки камней светом листа кольца; дефолт 1. */
export function resolveRingshineStrength(data: Partial<IRingRenderingObject> | undefined, context: string): number {
  failOnProblems(data, context)
  return data?.ringshineStrength ?? 1
}

/** Щели лунок в единицах потребителя (toUnits переводит км). */
export function ringGapsOf(moonlets: readonly RingMoonlet[], toUnits: (km: number) => number): RingGap[] {
  return moonlets.map((m) => {
    const halfWidth = toUnits(m.gapKm / 2)
    return { radius: toUnits(m.radiusKm), halfWidth, edge: RING_GAP_EDGE_FRACTION * halfWidth }
  })
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

/** Маска щелей: 0 в середине щели, 1 снаружи, мягкий край; произведение по щелям. Зеркало GLSL ringGapMask (чанк RingGap). */
export function ringGapMask(r: number, gaps: readonly RingGap[]): number {
  let mask = 1
  for (const g of gaps) mask *= smoothstep(g.halfWidth - g.edge, g.halfWidth, Math.abs(r - g.radius))
  return mask
}

/** Маска на радиальные бины профиля (центр бина i — inner + (i + 0.5)/n·(outer − inner)); на месте. */
export function applyRingGapsToBins(values: Float32Array, inner: number, outer: number, gaps: readonly RingGap[]): Float32Array {
  if (gaps.length === 0) return values
  const n = values.length
  for (let i = 0; i < n; i++) values[i] *= ringGapMask(inner + ((i + 0.5) / n) * (outer - inner), gaps)
  return values
}
