import type {
  ColorSpace,
  MagnificationTextureFilter,
  Mapping,
  MinificationTextureFilter,
  PixelFormat,
  TextureDataType,
  Wrapping
} from 'three'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'

export type ValueOf<T> = T[keyof T]

export enum AllowedCategories {
  barycenter,
  blackHole,
  star,
  planet,
  atmosphere,
  ring,
  nebula,
  brownDwarf,
  whiteDwarf
}

export type AllowedCategory = keyof typeof AllowedCategories

export enum ResourceLifecycles {
  resident,
  streamable
}

export type ResourceLifecycle = keyof typeof ResourceLifecycles

export enum ResourceTypes {
  diffuse,
  bump,
  cloud,
  night,
  specular,
  cube,
  height,
  slope,
  detailDiffuse,
  detailNormal,
  detailArm,
  detailNormal2,
  // Normal-карта ряби воды (арка water-shader, Task 1) — тайлящийся сет,
  // трипланарный getNoise сэмплирует её 3×4 раза (см. WaterShaderTemplate).
  // resident, wrapS+wrapT Repeat (спека Task 1) — как height/slope, не стрим.
  waterNormal
}

export type ResourceType = keyof typeof ResourceTypes

export type ResourceParameters = {
  mapping?: Mapping
  wrapS?: Wrapping
  wrapT?: Wrapping
  magFilter?: MagnificationTextureFilter
  minFilter?: MinificationTextureFilter
  format?: PixelFormat
  type?: TextureDataType
  anisotropy?: number
  colorSpace?: ColorSpace
}

export interface ICategory {
  readonly id: number
  readonly alias: AllowedCategory
  name: string
}

export interface IActor {
  readonly id: number
  readonly categoryId: number | AllowedCategory
  readonly parentId: number | null
  name: string
  description: string
  color: string
}

export interface IOrbit {
  readonly id: number
  readonly actorId: number
  semiMajorAxis: number
  eccentricity: number
  inclination: number
  argOfPeriapsis: number
  ascendingNode: number
  meanAnomalyAtEpoch: number
  /** Эпоха оскулирующих элементов — юлианская дата (сутки), на которую снята meanAnomalyAtEpoch */
  epoch: number
  /**
   * Явный сидерический период обращения, сутки; 0 = вывести из гравитационного
   * параметра. Обязателен для барицентрических подорбит (масса родителя-барицентра
   * не даёт корректного среднего движения)
   */
  period: number
}

export interface IRotationObject {
  readonly id: number
  readonly actorId: number
  meridianAngle: number
  ascendingNode: number
  inclination: number
  period: number
  direction?: 1 | -1
}

export interface IPhysicalObject {
  readonly id: number
  readonly actorId: number
  readonly parentId: number | null
  mass: number
  radius: number
  axialTilt: number
  orbitalPeriod: number
  rotationPeriod: number
  temperature: number
}

export interface IRenderingObject<T extends string = string, U = unknown> {
  readonly id: number
  readonly actorId: number
  data: Record<T, U>
}

/**
 * Статическая позиция актора — смещение от родителя в АСТРОНОМИЧЕСКИХ ЕДИНИЦАХ.
 *
 * Применима только к категориям с режимом позиционирования `placed`
 * (см. CATEGORY_RULES в validateDatabase). У акторов, чья позиция считается
 * по кеплеровой модели, строка здесь была бы ложью: DynamicNode перетирает
 * position на первом же кадре. Валидатор такую пару считает ошибкой.
 */
export interface IPlacement {
  readonly id: number
  readonly actorId: number
  x: number
  y: number
  z: number
}

export interface IResource extends ResourceParameters {
  readonly id: number
  readonly resourceType: ResourceType
  readonly lifecycle: ResourceLifecycle
  readonly path: string
}

export interface IActorResource {
  readonly id: number
  readonly actorId: number
  readonly resourceId: number
}

/**
 * Ресурс, обогащённый привязкой к актору в точке сбора (actor.resources).
 * Сама таблица resources связана с акторами через пивот actorResource
 * (many-to-many), поэтому actorId у ресурса появляется только в контексте
 * конкретного актора — например, для группировки отложенных текстур.
 */
export interface IActorBoundResource extends IResource {
  readonly actorId?: number | null
}

export interface IPlanetRenderingObject {
  emission: number
  bumpScale: number

  // --- Ручки терраформного детального слоя (задача 4, TerrainDetail). ---
  // Все опциональны: отсутствие → нейтральные дефолты движка (PlanetShader).
  // Периоды — в МЕТРАХ, пересчёт в юниты (1/период) — на CPU в PlanetShader.
  detailScaleMeters?: number
  detailScale2Meters?: number
  detailNormalScale?: number
  detailSaturation?: number
  detailBrightness?: number
  detailAoInfluence?: number

  // Дальность fade — метры дистанции камеры до конца fade каждой шкалы.
  // Начало fade = 0.4 × конца, зашито в PlanetShader (не отдельная ручка).
  detailFadeMeters?: number
  detailFade2Meters?: number

  // Cavity-затемнение альбедо из канала B slope-карты (арка slope-cavity,
  // Task 2/3). Отсутствие поля = 0 — путь бит-в-бит прежним (PlanetMaterial).
  cavityStrength?: number

  /**
   * Ламберт суши (терраформный путь): 0 — выключен (дневной цвет не зависит
   * от N·L, как у легаси-текстур с запечённым освещением), 1 — полный
   * max(N·L, 0) с полом terrainAmbient. Дефолт 0.
   */
  terrainLambert?: number
  /** Пол ламберта (0..1): рассеянный свет в тени рельефа. Дефолт 0.04. */
  terrainAmbient?: number

  /**
   * Уровень воды, метры (арка water-foundation, Task 3+). Гейт водной
   * оболочки в RenderableFactory: WaterSphere строится, когда у актора ЕСТЬ
   * height-карта И это поле — число (может быть отрицательным, уровень ниже
   * номинального радиуса тела — например, Явин IV −667.2 м). Отсутствие поля
   * = воды нет вовсе, ноль расходов.
   */
  waterLevelMeters?: number

  // --- Ручки WaterMaterial (арка water-foundation, Task 4). Все опциональны:
  // отсутствие → нейтральные дефолты движка (WaterShader). Цвета — число
  // 0xRRGGBB или строка '#rrggbb', та же конвенция, что dustColor кольца.

  /** Цвет глубокой воды (депонирована каналом A slope-карты → 1) */
  waterColor?: number | string
  /** Цвет мелкой воды/уреза (канал A → 0); без slope-карты не используется */
  waterShallowColor?: number | string
  /** Непрозрачность глубокой воды, 0..1. Без slope-карты — константная альфа тела целиком. */
  waterAlphaDeep?: number
  /** Тинт на грани тела (Френель) — грубая замена честному отражению неба */
  waterFresnelTint?: number | string
  /** Пол яркости ночной стороны воды, 0..1 (терминатор, см. WaterShaderTemplate). Без ручки — дефолт движка 0.08. */
  waterNightFloor?: number

  // --- Ручки ряби воды (арка water-shader, Task 1). Все опциональны:
  // отсутствие → нейтральные дефолты движка (WaterShader). Гейт
  // USE_WATER_WAVES — по наличию waterNormal-текстуры актора в resourceStorage
  // (см. WaterMaterial), не по этим ручкам — они лишь калибруют уже
  // включённые волны.

  /**
   * Множитель домена getNoise (см. WaterShaderTemplate) — 1 = периоды ряда
   * как есть, без искусственного зума. Безопасный диапазон: ≤1 для тел
   * радиусом ≤8192 км (тот же потолок, что у CPU-стража кванта,
   * WATER_WAVE_SMALLEST_PERIOD_METERS в WaterShader.ts) — scale>1 сжимает
   * ЭФФЕКТИВНЫЙ мельчайший период (period/scale) точно так же, как рост
   * радиуса тела растягивает quant(R): страж кванта считает по TS-константе
   * периода БЕЗ этой ручки и не заметит превышение на рантайме (финальное
   * whole-branch ревью, №4) — дефолт `waterWaveFadeMeters` компенсирует
   * автоматически (делится на scale), но явную ручку fade при scale>1
   * придётся уменьшать самостоятельно на тот же множитель.
   */
  waterWaveScale?: number
  /** Множитель скорости прокрутки uTime в getNoise. 1 = как есть. */
  waterWaveSpeed?: number
  /**
   * Дистанция затухания амплитуды нормали волн до чистого dir̂, метры камеры
   * до поверхности. Без ручки — дефолт: дистанция, где период мельчайшей
   * октавы (см. WaterShaderTemplate) опускается ниже ~1.5 экранного пикселя
   * (fov 50°/1080p, см. WaterShader).
   */
  waterWaveFadeMeters?: number

  /**
   * Дисторсия выборки отражения фоновой кубмапы (арка water-shader, Task 2,
   * см. WaterShaderTemplate) — масштаб добавки world-space нормали волн к
   * направлению отражения, аналог `distortionScale` Water.js
   * (`surfaceNormal.xy * (0.001 + 1.0 / distance) * distortionScale`). Без
   * ручки — дефолт движка 20. Инертна без USE_WATER_REFLECTION (гейт по
   * факту доставки кубмапы фона, см. WaterMaterial) — отложена в Task 1
   * явной записью (фикс-раунд 1, находка №7), реализована здесь.
   */
  waterDistortion?: number
}

export type IAtmosphereRenderingObject = AtmosphereConfig

export type INebulaRenderingObject = NebulaRenderingData

export interface IRingRenderingObject {
  innerRadius: number
  outerRadius: number
  alphaTest: number
  /**
   * Множитель базовой плотности астероидного поля (стример AsteroidRingSystem).
   * 1 → базовая плотность; >1 плотнее (напр. чтобы уплотнить тонкие колечки
   * разреженных колец). Стример при отсутствии значения берёт 1.
   */
  asteroidDensityScale: number

  // --- Визуальные ручки стримера AsteroidRingSystem (пер-кольцевой тюнинг). ---
  // Все опциональны: отсутствие → дефолт движка (AsteroidRingSystem.DEFAULT_CONFIG).
  // Машинерия (LOD-пороги, пулы, сетка, бюджеты) в модельный слой сознательно
  // не выносится — см. __modelVisualOverrides.

  /** Толщина кольца в км (вертикальный разброс камней) */
  thicknessKm?: number
  /** Размер геометрии отдельного астероида в км */
  asteroidSizeKm?: number
  /** Профиль облика камней: 'stony' | 'carbonaceous' | 'metallic' | 'icy' */
  profile?: string
  /** Мягкость кромок субколец для КАМНЕЙ: сигма размытия профиля плотности, км */
  ringGapBleedKm?: number
  /** Мягкость согласования ПЫЛИ с текстурой: сигма размытия профиля пыли, км */
  dustBleedKm?: number
  /** Включена ли пылевая дымка */
  dustEnabled?: boolean
  /** Цвет дымки: число 0xRRGGBB или строка '#rrggbb' */
  dustColor?: number | string
  /** Целевая оптическая толща грейзинг-луча (плотность дымки) */
  dustTauGrazing?: number
  /** Масштабная полутолщина пылевого слоя в км */
  dustScaleHeightKm?: number
}

export interface IBrownDwarfRenderingObject {
  seed?: number
  bandCount?: number
  turbulence?: number
  opticalDepth?: number
  gapGlow?: number
  limbDarkening?: number
  gapThreshold?: number
  deckSoftness?: number
  deckTint?: number
  parallax?: number
  breathAmplitude?: number
  bandWarp?: number
  zonalShear?: number
  fineDetail?: number
  polarChaos?: number
  vortexStrength?: number
  stormDepth?: number
}

/**
 * Белый карлик. Ручек мало намеренно: поверхность безлика по физике (радиативная
 * атмосфера у горячих, гранула в 1/6000 радиуса у холодных), и рисовать на ней
 * нечего. Яркость и лимбовое потемнение выводятся из температуры физического
 * объекта, а не задаются здесь — см. WhiteDwarfParameters.
 */
export interface IWhiteDwarfRenderingObject {
  /**
   * Множитель поверх откалиброванного уровня яркости
   * (WHITE_DWARF_DISPLAY_SCALE). Единица — нейтральное значение.
   */
  exposureBias?: number
}

export type Colorable = {
  r: number
  g: number
  b: number
}

export type TKeplerianModel = Omit<IOrbit, 'id' | 'actorId'>

export type TOrientationModel = Omit<IRotationObject, 'id' | 'actorId'>
