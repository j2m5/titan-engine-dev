import { clamp } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import { Colorable, IBrownDwarfRenderingObject } from '@/core/models/types'

/** Поздний L / переход L-T: на этой температуре палитра чисто красно-оранжевая */
export const BROWN_DWARF_DEFAULT_TEMPERATURE_K: number = 1600

/**
 * Спред палитры шире звёздного (400K): hot уходит в оранжевое нутро прогалин.
 * Холодный конец у обоих карликов (1210 K, 1350 K) при спреде 600 упирается
 * в COLOR_TEMPERATURE_FLOOR_K (1000 K) — cool у них равен цвету на 1000 K
 * независимо от величины спреда, и ручка двигает только горячую половину
 * палитры. Чтобы cool оторвался от пола, спред должен упасть ниже 210/350 K.
 */
export const BROWN_DWARF_PALETTE_SPREAD_K: number = 600

/** Затемнение облачной палубы относительно цвета палубы после подмешивания deckTint */
export const BROWN_DWARF_CLOUD_DIM: number = 0.25

/**
 * Опорный цвет тонировки палубы, линейный sRGB. Синий ВЫШЕ зелёного — это и
 * отличает сливовый от тёмно-красного; при B <= G оттенок уходит обратно в
 * кирпич.
 *
 * Умножением палубу к этому цвету не привести: у чёрнотельного цвета синий
 * равен ровно нулю ниже 1900 K, а ноль умножением не поднимается. Отсюда
 * подмешивание, а не множитель.
 */
export const BROWN_DWARF_DECK_PLUM: Readonly<Colorable> = { r: 1.0, g: 0.05, b: 0.22 }

export interface BrownDwarfParameters {
  seed: number
  bandCount: number
  turbulence: number
  opticalDepth: number
  gapGlow: number
  limbDarkening: number
  gapThreshold: number
  deckSoftness: number
  deckTint: number
  parallax: number
  breathAmplitude: number
  bandWarp: number
  zonalShear: number
  fineDetail: number
  polarChaos: number
  vortexStrength: number
  stormDepth: number
  temperature: number
}

/**
 * Ловушка связанных ручек: `bandWarp` — смещение широты в абсолютных единицах,
 * а ширина пояса равна 1/`bandCount`. Значит при правке числа поясов warp надо
 * масштабировать обратно пропорционально, иначе разброс ширин меняется вместе
 * с ними: половинное число поясов при прежнем warp даёт вдвое более ровные
 * пояса. Пара 4.5 / 0.16 держит ту же относительную неровность, что 9 / 0.08.
 */
const DEFAULTS: Omit<BrownDwarfParameters, 'temperature'> = {
  seed: 4096,
  bandCount: 4.5,
  turbulence: 1.6,
  opticalDepth: 3,
  gapGlow: 3.3,
  /**
   * Сила лимбового потемнения прогалин, линейный закон I = 1 − u·(1 − mu).
   * У прогалины tau равен нулю, и деление на mu в bdTauEff ей потемнения не
   * даёт — этот член единственный. Ноль — точка отката.
   */
  limbDarkening: 0.6,
  gapThreshold: 0.42,
  /**
   * Мягкость кромки палубы в единицах ПЛОТНОСТИ — складывается с полушириной
   * от экранного футпринта. Футпринт отвечает за сглаживание и обязан быть в
   * пару пикселей; мягкость живёт в плотности и потому раскрывается при
   * приближении. Ноль — точка отката.
   *
   * Полностью открытая прогалина требует, чтобы gapThreshold − w опустился
   * ниже достижимого минимума плотности — он около 0.09, потому что поле
   * строится как 0.65·полосы + 0.35·шум и слагаемое шума не даёт плотности
   * упасть в ноль. Поэтому безопасный потолок мягкости НЕ равен gapThreshold:
   * он ниже на этот минимум и ещё на слагаемое от футпринта, то есть плывёт
   * вместе с дистанцией до тела. Кламп [0, 1] этого не ловит.
   */
  deckSoftness: 0.20,
  /**
   * Сила подмешивания палубы к BROWN_DWARF_DECK_PLUM. Трогает только палубу:
   * прогалины остаются планковскими, и палуба с прогалинами расходятся по
   * тону, а не только по светлоте. Ноль — точка отката.
   */
  deckTint: 0.5,
  parallax: 0.02,
  breathAmplitude: 0.08,
  bandWarp: 0.16,
  zonalShear: 0.5,
  fineDetail: 0.25,
  polarChaos: 0.8,
  vortexStrength: 0.35,
  /**
   * Насколько шторм прорежает палубу. Овал вычитается из плотности до порога,
   * поэтому мягкую кромку и горячее ядро он получает от deckSoftness и
   * bdDepth сам. Ноль — точка отката, овалов нет.
   */
  stormDepth: 0.5
}

/**
 * Параметры карлика из данных актора с дефолтами.
 *
 * Значения дефолтов — стартовая точка, посчитанная при проектировании, а НЕ
 * замер на картинке: приёмку по виду делает владелец.
 *
 * Ловушка: `??` вместо `||` принципиален — нулевые значения (выключенное
 * дыхание, выключенный параллакс) обязаны переживать чтение.
 */
export function brownDwarfParameters(actor: Actor): BrownDwarfParameters {
  const data: IBrownDwarfRenderingObject = readRenderingData<IBrownDwarfRenderingObject>(actor) ?? {}

  return {
    seed: data.seed ?? DEFAULTS.seed,
    bandCount: data.bandCount ?? DEFAULTS.bandCount,
    turbulence: data.turbulence ?? DEFAULTS.turbulence,
    opticalDepth: data.opticalDepth ?? DEFAULTS.opticalDepth,
    gapGlow: data.gapGlow ?? DEFAULTS.gapGlow,
    // Кламп по той же причине, что у breathAmplitude: при u > 1 множитель
    // 1 − u·(1 − mu) на малых mu отрицателен, то есть кромка получает
    // отрицательную светимость
    limbDarkening: clamp(data.limbDarkening ?? DEFAULTS.limbDarkening, 0, 1),
    gapThreshold: data.gapThreshold ?? DEFAULTS.gapThreshold,
    // Кламп несущий: отрицательная мягкость сужает полуширину ниже порога
    // сглаживания, а перевесив его — даёт smoothstep с e0 > e1, что в GLSL
    // не определено
    deckSoftness: clamp(data.deckSoftness ?? DEFAULTS.deckSoftness, 0, 1),
    // Кламп по той же причине, что у соседей: mixColor экстраполирует за
    // пределы [0, 1] — при t < 0 синий уходит в минус сразу (b = 0.22·t),
    // при больших t в минус уходит зелёный
    deckTint: clamp(data.deckTint ?? DEFAULTS.deckTint, 0, 1),
    parallax: data.parallax ?? DEFAULTS.parallax,
    // Кламп, а не просто чтение: bdBreath даёт [1-a, 1+a], и при a > 1
    // яркость нутра уходит в минус — отрицательная светимость
    breathAmplitude: clamp(data.breathAmplitude ?? DEFAULTS.breathAmplitude, 0, 1),
    bandWarp: data.bandWarp ?? DEFAULTS.bandWarp,
    zonalShear: data.zonalShear ?? DEFAULTS.zonalShear,
    fineDetail: data.fineDetail ?? DEFAULTS.fineDetail,
    polarChaos: data.polarChaos ?? DEFAULTS.polarChaos,
    vortexStrength: data.vortexStrength ?? DEFAULTS.vortexStrength,
    // Кламп несущий: при отрицательной глубине шторм не прорежает палубу, а
    // сгущает её, и овал становится тёмным пятном в тёмном поясе
    stormDepth: clamp(data.stormDepth ?? DEFAULTS.stormDepth, 0, 1),
    temperature:
      actor.physicalObject?.getAttribute('temperature', BROWN_DWARF_DEFAULT_TEMPERATURE_K) ??
      BROWN_DWARF_DEFAULT_TEMPERATURE_K
  }
}
