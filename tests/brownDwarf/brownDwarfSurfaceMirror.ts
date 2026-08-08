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

/** Эффективная толща: у кромки луч идёт по касательной и набирает больше вещества */
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

/** Тональная вариация палубы по высоте верхушки: база и размах */
export const CLOUD_TONE_BASE = 0.6
export const CLOUD_TONE_RANGE = 0.4

/** Потолок HDR — общий со звездой и атмосферой (half-float буфер, AgX-плечо) */
export const HDR_CEILING = 64

/**
 * Полная раскраска фрагмента: единственная точка композиции на оба LOD.
 * Зеркало односкалярное — цвет в GLSL векторный, но композиция покомпонентна,
 * поэтому свойства проверяются на одном канале.
 */
export function bdShade(
  field: readonly [number, number],
  mu: number,
  dir: readonly number[],
  cloud: number,
  hot: number,
  opticalDepth: number,
  gapGlow: number,
  t: number,
  breathAmplitude: number
): number {
  const transmit: number = bdTransmit(bdTauEff(field[0], mu, opticalDepth))
  const hotLit: number = hot * gapGlow * bdBreath(dir, t, breathAmplitude)
  const cloudLit: number = cloud * (CLOUD_TONE_BASE + CLOUD_TONE_RANGE * field[1])

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
