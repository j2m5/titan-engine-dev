import { Vector3 } from 'three'

/** Порог «буфер не записан»: глубина ≥ 1 − ε читается как небо. */
export const SKY_DEPTH_EPSILON = 1e-6

/**
 * Лог-глубина three (`logdepthbuf_fragment`): z = log2(1 + w)/log2(far + 1),
 * w = −viewZ в юнитах. Обратно: w = 2^(z·log2(far+1)) − 1. Глубина — вдоль
 * ОСИ камеры, длина луча = w / |dirViewZ|. Юниты → км: × 1/spaceScale.
 * Не через `readDepth` postprocessing: тот идёт через перспективную глубину
 * с cameraFar (2000 а.е.) и теряет ~20 % на 6400 км.
 */
export function logDepthToDistanceKm(z: number, dirViewZ: number, far: number, spaceScale: number): number {
  if (z >= 1 - SKY_DEPTH_EPSILON) return Infinity
  const w = Math.pow(2, z * Math.log2(far + 1)) - 1
  return (w / -dirViewZ) / spaceScale
}

export interface ShellSegment {
  /** Вход в оболочку вдоль луча, км (0 — камера внутри) */
  t0: number
  /** Конец отрезка: выход из оболочки или поверхность, км */
  t1: number
  /** Отрезок упёрся в поверхность (глубина сцены), а не вышел в космос */
  hitSurface: boolean
}

/**
 * Отрезок луча внутри сферы `top`. Камера — начало координат, `dir` единичный.
 * null — луч мимо оболочки или поверхность перед ней (затуманивать нечего).
 * Дно сферы `bottom` — грунт модели: ниже него луч не продолжается.
 */
export function clipRayToShell(
  dir: Vector3,
  centerKm: Vector3,
  topRadiusKm: number,
  bottomRadiusKm: number,
  distKm: number
): ShellSegment | null {
  // |dir·t − c|² = top² → t² − 2(dir·c)t + |c|² − top² = 0
  const b = dir.dot(centerKm)
  const cc = centerKm.lengthSq()
  const c = cc - topRadiusKm * topRadiusKm
  const disc = b * b - c
  if (disc <= 0) return null

  const root = Math.sqrt(disc)
  const tExit = b + root
  if (tExit <= 0) return null // оболочка целиком позади

  const inside = c < 0
  const t0 = inside ? 0 : b - root
  if (t0 >= distKm) return null // поверхность перед оболочкой

  let hitSurface = distKm < tExit
  let t1 = hitSurface ? distKm : tExit

  // Дно оболочки — грунт модели Брунетона: под bottom LUT не заданы. Глубина
  // может уводить конец ниже (дно океана под прозрачной водой без depthWrite,
  // ошибка декода ~20 м) — обрезаем первым положительным корнем сферы дна.
  // Камера уже ниже дна (cBottom ≤ 0) — обрезка пропускается: точку у дна
  // вытягивает кламп +0.01 км ниже по коду.
  const cBottom = cc - bottomRadiusKm * bottomRadiusKm
  const discBottom = b * b - cBottom
  if (cBottom > 0 && discBottom > 0) {
    const tBottom = b - Math.sqrt(discBottom)
    if (tBottom > 0 && tBottom < t1) {
      t1 = tBottom
      hitSurface = true
    }
  }

  return { t0, t1, hitSurface }
}

export interface SlotCandidate<T> {
  entry: T
  distKm: number
  /** top/dist; Infinity, когда камера внутри оболочки */
  angular: number
}

/**
 * Отбор K оболочек в кадр. Порядок — от дальней к ближней: вложенные
 * оболочки (Титан внутри кадра Сатурна) композируются дальняя первой.
 * Потолок K — видимые, но отброшенные возвращаются для лога (без молчаливых
 * потолков). Записи мельче `minAngular` (top/dist) невидимы — отсев, не дроп.
 */
export function orderSlots<T>(
  items: Array<{ entry: T; centerKm: Vector3; topRadiusKm: number }>,
  slots: number,
  minAngular: number
): { chosen: SlotCandidate<T>[]; dropped: T[] } {
  const visible: SlotCandidate<T>[] = []
  const dropped: T[] = []

  for (const item of items) {
    const distKm = item.centerKm.length()
    const angular = distKm < item.topRadiusKm ? Infinity : item.topRadiusKm / distKm
    if (angular < minAngular) {
      dropped.push(item.entry)
      continue
    }
    visible.push({ entry: item.entry, distKm, angular })
  }

  // Ближние важнее: оставляем K ближайших, затем переворачиваем в порядок композиции
  visible.sort((a, b) => a.distKm - b.distKm)
  const kept = visible.slice(0, slots)
  for (const extra of visible.slice(slots)) dropped.push(extra.entry)
  kept.sort((a, b) => b.distKm - a.distKm)

  return { chosen: kept, dropped }
}
