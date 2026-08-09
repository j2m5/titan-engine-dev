/**
 * CPU-зеркало GLSL-функций чанка BrownDwarfSurface.
 *
 * ВАЖНО: менять строго синхронно с
 * src/core/materials/shaders/lib/chunks/BrownDwarfSurface.ts — числовые тесты
 * (BrownDwarfSurface.spec.ts) проверяют именно эту реализацию, GLSL обязан
 * повторять её один в один.
 */

/** Направления фаз дыхания. Дубль констант из GLSL — менять синхронно. */
export const BREATH_AXES: readonly [number, number, number][] = [
  [0.71, 0.43, 0.55],
  [-0.36, 0.82, 0.44],
  [0.52, -0.29, 0.8]
]

const dot3 = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Эффективная толща палубы: у кромки луч идёт по касательной и набирает больше
 * вещества, поэтому палуба к лимбу темнеет сама.
 *
 * Ловушка: у прогалины tau равен НУЛЮ, и ноль, делённый на mu, остаётся нулём
 * при любом угле — ей потемнение даёт отдельный член в bdShade.
 */
export function bdTauEff(tau: number, mu: number, opticalDepth: number): number {
  return (tau * opticalDepth) / Math.max(mu, 1e-3)
}

/** Пропускание палубы. Непрерывно, края не имеет — в отличие от порога */
export function bdTransmit(tauEff: number): number {
  return Math.exp(-tauEff)
}

/** Композиция: излучательная способность слоя равна (1 - пропускание) */
export function bdCompose(cloud: number, hot: number, transmit: number): number {
  return cloud * (1 - transmit) + hot * transmit
}

/** Дыхание яркости суммой синусов: ограничено [1-a, 1+a] аналитически */
export function bdBreath(dir: readonly number[], t: number, amplitude: number): number {
  const s =
    Math.sin(dot3(dir, BREATH_AXES[0]) * 3 + t * 0.11) +
    Math.sin(dot3(dir, BREATH_AXES[1]) * 5 - t * 0.07) +
    Math.sin(dot3(dir, BREATH_AXES[2]) * 8 + t * 0.19)

  return 1 + (amplitude * s) / 3
}

/**
 * Яркость мелкой прорехи как доля от глубокой.
 *
 * Без этого множителя красный канал равнялся бы gapGlow по всей прогалине
 * разом: у чёрнотельных цветов он нормирован единицей, и глубина меняла бы
 * только оттенок. Вся прореха уходила в плечо кривой и выцветала в белый.
 */
export const GAP_GLOW_FLOOR = 0.45

/** Растяжка высоты: сырой fbm держится в ±0.4, и палуба не доходила до краёв */
export const HEIGHT_CONTRAST = 1.25

/**
 * Разброс толщи палубы ВЫШЕ порога: возвращает в тёмные пояса форму вихрей,
 * которую порог обрезал в единицу. Равенство единице — откат.
 */
export const DECK_RELIEF_LOW = 0.85
export const DECK_RELIEF_HIGH = 1.25

/** Потолок HDR — общий со звездой и атмосферой (half-float буфер, AgX-плечо) */
export const HDR_CEILING = 64

const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t

/**
 * Полная раскраска фрагмента: единственная точка композиции на оба LOD.
 * Зеркало односкалярное — цвет в GLSL векторный, но композиция покомпонентна,
 * поэтому свойства проверяются на одном канале.
 *
 * field: [0] — толща палубы, [1] — высота верхушки, [2] — глубина видимости
 * в прогалине (bdDepth, до порога).
 */
export function bdShade(
  field: readonly [number, number, number],
  mu: number,
  dir: readonly number[],
  cloud: number,
  cloudHigh: number,
  hot: number,
  hotDeep: number,
  opticalDepth: number,
  gapGlow: number,
  limbDarkening: number,
  t: number,
  breathAmplitude: number
): number {
  const transmit: number = bdTransmit(bdTauEff(field[0], mu, opticalDepth))
  // Линейный закон потемнения к краю. Пол 1 − u на силуэте: степенной закон
  // обратился бы там в ноль, то есть в чёрную кромку
  const limb: number = 1 - limbDarkening * (1 - mu)
  const glow: number = gapGlow * mix(GAP_GLOW_FLOOR, 1, field[2]) * limb
  const hotLit: number = mix(hot, hotDeep, field[2]) * glow * bdBreath(dir, t, breathAmplitude)
  // Отдельного тонового множителя нет: он рос с высотой, а цвет падал, и они
  // гасили друг друга — перепад по палубе выходил 1.11 раза
  const cloudLit: number = mix(cloud, cloudHigh, field[1])

  return Math.min(bdCompose(cloudLit, hotLit, transmit), HDR_CEILING)
}

/** Полосы прибиты к широте, шум их гнёт: latitude — y единичной сферы */
export function bdBands(latitude: number, noise: number, bandCount: number, turbulence: number): number {
  return 0.5 + 0.5 * Math.sin(latitude * Math.PI * bandCount + noise * turbulence)
}

/** Смешение полос с локальным шумом: полосы рвутся, а не остаются зеброй */
export const BAND_NOISE_MIX = 0.35

export function bdDensity(bands: number, noise: number): number {
  return bands * (1 - BAND_NOISE_MIX) + (0.5 + 0.5 * noise) * BAND_NOISE_MIX
}

/** Минимальная полуширина порога: ниже неё край становится ступенькой */
export const GAP_MIN_WIDTH = 0.004

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Порог, открывающий прогалины. Полуширина растёт с экранным футпринтом:
 * порог с фиксированной шириной под HDR-контрастом работает усилителем
 * субпиксельного шума — именно поэтому его убирали в первой реализации.
 * `footprint` — это `fwidth(density)` со стороны GLSL.
 */
export function bdGap(density: number, threshold: number, footprint: number): number {
  const w: number = Math.max(footprint * 1.5, GAP_MIN_WIDTH)

  return smoothstep(threshold - w, threshold + w, density)
}

/**
 * Насколько глубоко видно сквозь прогалину: 1 — палуба разошлась полностью,
 * 0 — сомкнута. Считается от плотности ДО порога: после порога значение
 * почти двоичное, и градиента в нём уже нет.
 */
export function bdDepth(density: number, threshold: number): number {
  return 1 - smoothstep(0, threshold, density)
}

/** Коробление широты: пояса перестают быть равной ширины */
export function bdWarpLatitude(latitude: number, warpNoise: number, bandWarp: number): number {
  return latitude + warpNoise * bandWarp
}

/**
 * Угол зонального сдвига по широте. Соседние струи едут в разные стороны,
 * поэтому знак чередуется с тем же периодом, что и пояса: попавшее между
 * ними вытягивается вдоль пояса. Домен коробится, а не поле, — размытия нет.
 */
export function bdShearAngle(latitude: number, bandCount: number, zonalShear: number): number {
  return Math.sin(latitude * Math.PI * bandCount) * zonalShear
}

/**
 * Пер-поясная сила турбулентности: одни пояса спокойные зоны, другие бурлят.
 * Гладкая функция широты, а не ступенька по номеру пояса — ступенька дала бы
 * шов на границе.
 */
export function bdBandChaos(chaosNoise: number): number {
  return 0.4 + 0.6 * (0.5 + 0.5 * chaosNoise)
}

/**
 * Вес полосности по широте: к полюсам полосы гаснут. У Юпитера полярнее
 * примерно 60° ленты распадаются на скопления вихрей; у быстрых вращателей
 * это выражено сильнее. 1 — чистые пояса, 0 — изотропная турбулентность.
 */
export function bdPolarWeight(latitude: number, polarChaos: number): number {
  const t: number = smoothstep(0.75, 0.95, Math.abs(latitude))

  return 1 - t * polarChaos
}
