/**
 * Профили облика астероидов (см. чанк AsteroidSurface).
 *
 * Профиль — именованный набор параметров процедурного облика. Кольцо выбирает
 * ОДИН профиль через AsteroidRingConfig.profile; AsteroidRingSystem раскладывает
 * его значения по юниформам L0-материала. Значения стартовые, тюнятся визуально.
 */
export interface AsteroidProfile {
  /** Базовый цвет породы (hex) */
  baseColor: number
  /** Амплитуда per-instance джиттера яркости (±доля) */
  colorJitter: number
  /** Сила внутриповерхностного оттеночного мотла */
  tintStrength: number
  /** Сила крупномасштабного альбедо maria/highlands (0 → выкл): затемнение
   *  базальтовых равнин относительно возвышенностей. Даёт макро-композицию. */
  mariaStrength: number
  /** Сила микрозерна (высота ВЧ-рельефа) */
  grainStrength: number
  /** Частота микрозерна */
  grainFreq: number
  /** Частота Worley для кратеров */
  craterFreq: number
  /** Порог наличия кратера в ячейке [0..1] */
  craterDensity: number
  /** Радиус кратера (доля ячейки) */
  craterRadius: number
  /** Глубина кратера */
  craterDepth: number
  /** Число октав Worley (1–2) — ручка перфа */
  craterOctaves: number
  /** Толщина трещин */
  crackWidth: number
  /** Сила трещин (0 → выкл) */
  crackIntensity: number
  /** Патчевость трещин */
  crackPatchiness: number
  /** Сила каверн-AO */
  aoStrength: number
  /** Масштаб возмущения нормали от рельефа */
  craterNormalScale: number
  /** Ambient-подсветка тёмной стороны */
  surfaceAmbient: number
  /** Сила specular-блика (0 → матовый) */
  specularStrength: number
  /** Жёсткость блика (большой = резкий металл) */
  specularPower: number
  /** Тинт блика: 0 белый диэлектрик → 1 под цвет металла */
  specularTint: number
}

export type AsteroidProfileName = 'stony' | 'carbonaceous' | 'metallic' | 'icy'

export const ASTEROID_PROFILES: Record<AsteroidProfileName, AsteroidProfile> = {
  // Силикатный/каменный — матовый серо-коричневый, дефолт
  stony: {
    baseColor: 0x6b6157, colorJitter: 0.12, tintStrength: 0.25, mariaStrength: 0.3,
    grainStrength: 0.15, grainFreq: 22.0,
    craterFreq: 2.5, craterDensity: 0.6, craterRadius: 0.5, craterDepth: 0.5, craterOctaves: 1,
    crackWidth: 0.05, crackIntensity: 0.5, crackPatchiness: 0.7,
    aoStrength: 0.6, craterNormalScale: 1.0, surfaceAmbient: 0.03,
    specularStrength: 0.05, specularPower: 8.0, specularTint: 0.0
  },
  // Углистый — очень тёмный, сильно кратерированный, матовый
  carbonaceous: {
    baseColor: 0x2b2824, colorJitter: 0.08, tintStrength: 0.2, mariaStrength: 0.22,
    grainStrength: 0.2, grainFreq: 26.0,
    craterFreq: 3.2, craterDensity: 0.75, craterRadius: 0.45, craterDepth: 0.7, craterOctaves: 2,
    crackWidth: 0.04, crackIntensity: 0.25, crackPatchiness: 0.8,
    aoStrength: 0.7, craterNormalScale: 1.1, surfaceAmbient: 0.02,
    specularStrength: 0.0, specularPower: 8.0, specularTint: 0.0
  },
  // Железный — тёплый серый, мало кратеров, резкий окрашенный блик
  metallic: {
    baseColor: 0x8a8079, colorJitter: 0.1, tintStrength: 0.15, mariaStrength: 0.14,
    grainStrength: 0.06, grainFreq: 18.0,
    craterFreq: 2.5, craterDensity: 0.35, craterRadius: 0.4, craterDepth: 0.3, craterOctaves: 1,
    crackWidth: 0.05, crackIntensity: 0.0, crackPatchiness: 0.7,
    aoStrength: 0.5, craterNormalScale: 0.8, surfaceAmbient: 0.04,
    specularStrength: 0.6, specularPower: 48.0, specularTint: 0.8
  },
  // Ледяной — голубовато-белый, мягкие кратеры, ледяные сетки трещин, мягкий блик
  icy: {
    baseColor: 0xc4d2dc, colorJitter: 0.06, tintStrength: 0.12, mariaStrength: 0.2,
    grainStrength: 0.05, grainFreq: 16.0,
    craterFreq: 2.2, craterDensity: 0.3, craterRadius: 0.55, craterDepth: 0.25, craterOctaves: 1,
    crackWidth: 0.06, crackIntensity: 0.7, crackPatchiness: 0.5,
    aoStrength: 0.4, craterNormalScale: 0.7, surfaceAmbient: 0.06,
    specularStrength: 0.5, specularPower: 12.0, specularTint: 0.0
  }
}
