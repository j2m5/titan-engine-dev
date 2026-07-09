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
    surfaceAmbient: 0.03,
    specularStrength: 0.05, specularPower: 8.0, specularTint: 0.0
  },
  // Углистый — очень тёмный, матовый
  carbonaceous: {
    baseColor: 0x2b2824, colorJitter: 0.08, tintStrength: 0.2, mariaStrength: 0.22,
    surfaceAmbient: 0.02,
    specularStrength: 0.0, specularPower: 8.0, specularTint: 0.0
  },
  // Железный — тёплый серый, резкий окрашенный блик
  metallic: {
    baseColor: 0x8a8079, colorJitter: 0.1, tintStrength: 0.15, mariaStrength: 0.14,
    surfaceAmbient: 0.04,
    specularStrength: 0.6, specularPower: 48.0, specularTint: 0.8
  },
  // Ледяной — голубовато-белый, мягкий блик
  icy: {
    baseColor: 0xc4d2dc, colorJitter: 0.06, tintStrength: 0.12, mariaStrength: 0.2,
    surfaceAmbient: 0.06,
    specularStrength: 0.5, specularPower: 12.0, specularTint: 0.0
  }
}
