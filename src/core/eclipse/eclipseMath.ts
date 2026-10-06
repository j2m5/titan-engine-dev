// CPU-зеркало чанка Eclipse: доля видимого диска звезды при перекрытии дисками тел-соседей.
// Без импортов three — чистые функции над кортежами. GLSL обязан совпадать формулами.

export type Vec3 = [number, number, number]

/** Сколько затеняющих тел передаётся в шейдер (размер юниформ-массивов). */
export const MAX_OCCLUDERS = 4

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi)

/** Угол между единичными векторами через полухорду: точен на малых углах (acos(dot) в float32 — нет). */
export function diskSeparation(nS: Vec3, nO: Vec3): number {
  return 2 * Math.asin(clamp(0.5 * len(sub(nS, nO)), 0, 1))
}

/** Доля диска звезды (угл. радиус aS), не закрытая диском тела (aO) при угле θ между центрами. Плоское приближение. */
export function visibleFraction(aS: number, aO: number, theta: number): number {
  if (theta >= aS + aO) return 1
  if (theta <= Math.abs(aS - aO)) return aO >= aS ? 0 : 1 - (aO * aO) / (aS * aS)
  const d = theta
  const a1 = aS * aS * Math.acos(clamp((d * d + aS * aS - aO * aO) / (2 * d * aS), -1, 1))
  const a2 = aO * aO * Math.acos(clamp((d * d + aO * aO - aS * aS) / (2 * d * aO), -1, 1))
  const a3 = 0.5 * Math.sqrt(Math.max((-d + aS + aO) * (d + aS - aO) * (d - aS + aO) * (d + aS + aO), 0))
  return clamp(1 - (a1 + a2 - a3) / (Math.PI * aS * aS), 0, 1)
}

export interface Occluder {
  center: Vec3
  radius: number
  /** Цвет (нормированный) и сила подсветки умбры; нет — чёрная умбра */
  umbra?: { tint: Vec3; glow: number }
}

/** Свет звезды в точке: видимая доля диска (произведение по телам) плюс подсветка умбр тел с атмосферой. */
export function eclipseLightCpu(point: Vec3, star: Vec3, starRadius: number, occluders: Occluder[]): Vec3 {
  if (occluders.length === 0) return [1, 1, 1]
  const vS = sub(star, point)
  const dS = len(vS)
  const nS: Vec3 = [vS[0] / dS, vS[1] / dS, vS[2] / dS]
  const aS = Math.asin(Math.min(1, starRadius / dS))
  let visible = 1
  const glow: Vec3 = [0, 0, 0]
  for (const o of occluders) {
    const vO = sub(o.center, point)
    if (dot(vO, vS) <= 0) continue
    const dO = len(vO)
    const aO = Math.asin(Math.min(1, o.radius / dO))
    const v = visibleFraction(aS, aO, diskSeparation(nS, [vO[0] / dO, vO[1] / dO, vO[2] / dO]))
    visible *= v
    if (o.umbra) for (const c of [0, 1, 2] as const) glow[c] += (1 - v) * o.umbra.glow * o.umbra.tint[c]
  }
  return [visible + glow[0], visible + glow[1], visible + glow[2]]
}

export interface Candidate {
  center: Vec3
  radius: number
  actorId: number
}

/**
 * Затеняющие тела получателя (индексы в candidates, ≤ MAX_OCCLUDERS). Звезда — в нуле.
 * Кандидат: ближе к звезде вдоль направления на неё и в пределах суммы угловых радиусов
 * (свой + звезды) с запасом на размер получателя; порядок — по запасу перекрытия.
 */
export function selectOccluders(
  receiverCenter: Vec3,
  receiverRadius: number,
  starRadius: number,
  candidates: Candidate[],
  selfActorId: number
): number[] {
  const toStar: Vec3 = [-receiverCenter[0], -receiverCenter[1], -receiverCenter[2]]
  const dS = len(toStar)
  if (dS <= 0) return []
  const nS: Vec3 = [toStar[0] / dS, toStar[1] / dS, toStar[2] / dS]
  const aS = Math.asin(Math.min(1, starRadius / dS))
  const picked: { index: number; margin: number }[] = []
  candidates.forEach((c, index) => {
    if (c.actorId === selfActorId) return
    const v = sub(c.center, receiverCenter)
    const d = len(v)
    if (d <= 1e-9 || dot(v, nS) <= 0) return
    const theta = diskSeparation(nS, [v[0] / d, v[1] / d, v[2] / d])
    const reach = Math.asin(Math.min(1, (c.radius + receiverRadius) / d)) + aS
    if (theta >= reach) return
    picked.push({ index, margin: theta - Math.asin(Math.min(1, c.radius / d)) })
  })
  return picked.sort((a, b) => a.margin - b.margin).slice(0, MAX_OCCLUDERS).map((p) => p.index)
}
