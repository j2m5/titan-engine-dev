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
  /** Осветление свежего скола разлома (см. surfaceData.x — freshness из
   *  ArchetypeShape.surfaceAt): меньше налипшего реголита на недавнем изломе.
   *  Лёд заметно светлеет на сколах — выше остальных пород. */
  freshnessBrighten: number
  /** Затенение днищ кратерных чаш (см. surfaceData.y — cavity):
   *  самозатенение AO глубоких впадин от запечённого рельефа. */
  cavityShade: number
  /**
   * Доля Ломмеля-Зелигера в диффузе (см. чанк AsteroidBrdf): 0 — Ламберт
   * («пластиковый шар»), 1 — реголит, ровный по диску с резким лимбом. Тёмный
   * пылевой реголит (углистые) ближе к 1, металл с гладкими сколами — к Ламберту.
   */
  lunarMix: number
  /** Сила оппозиционного пика при взгляде со стороны звезды (0 — нет) */
  oppositionSurge: number
  /**
   * Пропорции морфологий в библиотеке архетипов породы (сумма ≈ 1):
   * fragment — осколок Вороного (свежий скол/удар), rubble — слипшиеся
   * лобы (гравитационная переупаковка), cratered — монолит с чашами (старая
   * поверхность). Каменные/углистые тела чаще дробятся при столкновениях
   * (выше fragment/rubble); металл держит форму монолита лучше камня —
   * cratered/fragment сопоставимы с камнем, rubble ниже; лёд колется свежими
   * расколами чаще, чем накапливает rubble-переупаковку.
   */
  morphologyWeights: {
    fragment: number
    rubble: number
    cratered: number
  }
  /**
   * Базовое имя PBR-сета трипланарных детальных карт (файлы вида
   * `asteroids/<detailSet>_{diff,nor_gl,arm}_2k.jpg`). Сет пер-профильный,
   * потому что задаёт ФАКТУРУ породы (трещины/крошка/плиты) — независимо
   * от него цвет всё равно грейдится через uRockColor (baseColor выше).
   * Ледяные тела получают собственную структуру поверхности (глыбы льда
   * с трещинами) вместо общей каменной.
   */
  detailSet: string
}

export type AsteroidProfileName = 'stony' | 'carbonaceous' | 'metallic' | 'icy'

export const ASTEROID_PROFILES: Record<AsteroidProfileName, AsteroidProfile> = {
  // Силикатный/каменный — матовый серо-коричневый, дефолт
  stony: {
    baseColor: 0x6b6157, colorJitter: 0.12, tintStrength: 0.25, mariaStrength: 0.3,
    surfaceAmbient: 0.03,
    specularStrength: 0.05, specularPower: 8.0, specularTint: 0.0,
    freshnessBrighten: 0.15, cavityShade: 0.5,
    lunarMix: 0.8, oppositionSurge: 0.3,
    morphologyWeights: { fragment: 0.6, rubble: 0.25, cratered: 0.15 },
    detailSet: 'rock_boulder_dry'
  },
  // Углистый — очень тёмный, матовый
  carbonaceous: {
    baseColor: 0x2b2824, colorJitter: 0.08, tintStrength: 0.2, mariaStrength: 0.22,
    surfaceAmbient: 0.02,
    specularStrength: 0.0, specularPower: 8.0, specularTint: 0.0,
    freshnessBrighten: 0.1, cavityShade: 0.5,
    lunarMix: 0.9, oppositionSurge: 0.4,
    morphologyWeights: { fragment: 0.5, rubble: 0.35, cratered: 0.15 },
    detailSet: 'rock_boulder_dry'
  },
  // Железный — тёплый серый, резкий окрашенный блик
  metallic: {
    baseColor: 0x8a8079, colorJitter: 0.1, tintStrength: 0.15, mariaStrength: 0.14,
    surfaceAmbient: 0.04,
    specularStrength: 0.6, specularPower: 48.0, specularTint: 0.8,
    freshnessBrighten: 0.2, cavityShade: 0.5,
    lunarMix: 0.4, oppositionSurge: 0.15,
    morphologyWeights: { fragment: 0.7, rubble: 0.15, cratered: 0.15 },
    detailSet: 'rock_boulder_dry'
  },
  // Ледяной — голубовато-белый, мягкий блик
  icy: {
    baseColor: 0xc4d2dc, colorJitter: 0.06, tintStrength: 0.12, mariaStrength: 0.2,
    surfaceAmbient: 0.06,
    specularStrength: 0.5, specularPower: 12.0, specularTint: 0.0,
    freshnessBrighten: 0.3, cavityShade: 0.35,
    lunarMix: 0.5, oppositionSurge: 0.2,
    morphologyWeights: { fragment: 0.7, rubble: 0.2, cratered: 0.1 },
    detailSet: 'rocks_ground_04'
  }
}
