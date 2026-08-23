import process from 'node:process'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { encodeHeightMap } from './lib/heightMapEncode'
import { buildSlopeMap } from './lib/slopeMapEncode'
import { synthesizeElevationHeightAndSlope, synthesizeHeightAndSlope } from './lib/synthesizeSlope'
import { autoCalibrateAmplitude, type CalibrationSample } from './lib/autoCalibrate'
import { argument } from './lib/cliArguments'
import {
  bandLowKmFor,
  boxDownsampleGreyscale,
  elevationHighPassSigmaTexels,
  elevationPeakMeters,
  elevationPeakPercentile,
  elevationSmoothSigmaTexels,
  resolutionCeiling
} from './lib/batchBodyRules'
import { slopeRangeForPath } from './lib/slopeRangeFromDb'
import { dbPathFor } from './lib/dbPathFor'
import { Resources } from '@storage/database/resources'

/**
 * Батч-оркестратор перевода тел без DEM на конвейер «тел без DEM» (арка
 * synth-heightmap): один прогон генерит height+slope для всех записей
 * `BODIES` — ВСЕ твёрдые тела без DEM, включая планеты (спутники, карликовые
 * планеты пояса Койпера/рассеянного диска, тела Звёздных Войн и безымянные
 * планеты; фикс-раунд 1 реального прогона развёл Коррибан I-VII на семь
 * ПЕР-ТЕЛО генераций, общий только вход-текстура, см. ниже; арка
 * terrain-standardization добавила финальные 19 — луны Сатурна/Урана и
 * оставшиеся тела Звёздных Войн/безымянные, см. докблок ниже). Математика
 * синтеза НЕ дублируется: `synthesizeHeightAndSlope` (`scripts/lib/synthesizeSlope.ts`)
 * вызывает тот же библиотечный конвейер, что и одиночный
 * `build:synth-heightmap` (`buildSynthHeightField`, `buildSlopeMap`,
 * писатель TEHM `encodeHeightMap`).
 *
 * Автокалибровка амплитуды (`autoCalibrateAmplitude`) подгоняет
 * `bumpAmplitudeMeters` под целевой RMS(tan) итоговой slope-карты вместо
 * фиксированного значения на тело — референс 3000 м, цель 0.07 (см. докблок
 * `autoCalibrate.ts`). Кламп 0.7% радиуса — ДВУХэтапный (фикс-раунд 1,
 * находка 1): `autoCalibrateAmplitude` сама клампит только ПАРАМЕТР
 * bump-амплитуды, а не итоговый пик поля (подложка ей не подконтрольна);
 * после калибровки `generateBody` меряет фактический max(|min|,|max|)
 * последнего прогона и, если он всё же над бюджетом, делает ОДНУ
 * повторную генерацию с пропорционально рескейленными bump- И base-
 * амплитудами (see `generateBody`).
 *
 * Вид входа `elevation` (Плутон, Европа, Эрида, Дисномия, Харон, Диона, Седна,
 * Ганимед, Ио) —
 * настоящая карта высот вместо bump/диффуза: ни подложки-шума, ни калибровки
 * по RMS — амплитуду задаёт бюджет высоты тела либо явная ручка `peakMeters`
 * на генерацию (Европа: пик занижен до 1800 м, бюджет 0.7% радиуса не
 * тронут), см. `elevationField`/`elevationPeakMeters`. Сглаживание входа —
 * дефолт `ELEVATION_SMOOTH_SIGMA_TEXELS` (0.7) либо явная ручка
 * `smoothSigmaTexels` на тело (Эрида: 1.5, Седна: 2.0 — зернистый вход; Харон:
 * 1.0 — 111 уровней яркости, ступени вдвое грубее обычного), см.
 * `elevationSmoothSigmaTexels`. Высокочастотный фильтр — явная ручка
 * `highPassKm` на тело (км волны, переводится в тексели формулой края
 * band-фильтра bump-входа): вычитает крупномасштабный тренд карты высот перед
 * нормировкой по пику, без ручки не применяется (Ганимед: 800 км — половина
 * дисперсии его карты лежит на масштабах шире 800 км, без фильтра пик 6000 м
 * уходил в широкие светлые/тёмные пятна вместо кратеров/борозд), см.
 * `elevationHighPassSigmaTexels`. Квантиль нормировки пика — явная ручка
 * `peakPercentile` на тело (0.9..1, дефолт 1 — максимум модуля, без клампа):
 * p<1 ставит на `peakMeters` не абсолютный максимум, а квантиль |h| — редкие
 * тексели-выбросы (шум скана/сшивки) не отъедают весь бюджет высоты у
 * типичного рельефа, превышение клампится в ±`peakMeters` (Ганимед: 0.999 —
 * замер показал, что верхние 0.1% текселей карты задавали половину амплитуды
 * нормировки), см. `elevationPeakPercentile`.
 *
 * Даунсемпл входа — до потолка по радиусу тела (или явного `ceilingWidth`), area-average (box) для
 * 8-бит растра (`boxDownsampleGreyscale`, тонкая самостоятельная реализация:
 * установленный sharp box-кернел не экспонирует, а `resampleDem.ts` заточен
 * под float DEM-числа другого конвейера — переиспользовать нечего).
 *
 * Пути вывода — `<каталог входного файла>/<имя>_height.raw` и `<имя>_slope.webp`
 * (имя — колонка «Генерация» списка ниже); у Корribана каталог входного
 * файла общий на семь генераций (входная текстура одна), но КАЖДАЯ из
 * korriban1..korriban7 пишет СВОИ height/slope — общий физический ресурс
 * Корribана в БД был ошибкой (радиус I откалиброван на VII дал 577% его
 * бюджета высоты), поэтому этот батч больше не производит общую карту.
 *
 * Запуск (все генерации списка):
 *   npm run build:moon-heightmaps
 * Перегенерировать одно тело:
 *   npm run build:moon-heightmaps -- --only rhea
 *
 * Энцелад в списке НЕ значится — он DEM-тело, как Церера (DEM Cassini,
 * Schenk 2024; см. `docs/terrain-handoff.md`).
 */

/** Дефолт подложки — тот же пресет cratered-icy, что и у одиночного build:synth-heightmap (докблок там же). */
const BASE_AMPLITUDE_METERS = 800
const REF_AMPLITUDE_METERS = 3000
const TARGET_RMS_TAN = 0.07
/** Кламп амплитуды — доля радиуса тела (0.7%). */
const HEIGHT_BUDGET_FRACTION = 0.007
/** band-high = N текселей экватора карты ВЫХОДНОГО разрешения тела. */
const BAND_HIGH_TEXELS = 2
/** σ сглаживания входа `elevation`, тексели выхода: срез 8-битных ступенек, не дорисовка рельефа. */
const ELEVATION_SMOOTH_SIGMA_TEXELS = 0.7

interface BodyGeneration {
  /** Колонка «Генерация» — имя выходных файлов и ключ `--only`. */
  name: string
  inputPath: string
  inputKind: BodyInputKind
  radiusMeters: number
  /** seed синтеза — actorId тела. */
  seedActorId: number
  /** actorId, ссылающийся на эту генерацию (по одному на генерацию — см. фикс-раунд 1, находка 2). */
  actorIds: readonly number[]
  /** Явный потолок разрешения вместо правила по радиусу (честный вход тянет больше текселей). */
  ceilingWidth?: number
  /** Пик высоты для входа `elevation` — ручка владельца на тело; без неё бюджет 0.7% радиуса (см. `elevationPeakMeters`). */
  peakMeters?: number
  /** σ сглаживания входа `elevation`, тексели выхода — ручка владельца на тело; без неё `ELEVATION_SMOOTH_SIGMA_TEXELS` (см. `elevationSmoothSigmaTexels`). */
  smoothSigmaTexels?: number
  /** Высокочастотный фильтр входа `elevation`, км волны — ручка владельца на тело; без неё фильтр не применяется (см. `elevationHighPassSigmaTexels`). */
  highPassKm?: number
  /** Квантиль |h| нормировки пика входа `elevation` (0.9..1) — ручка владельца на тело; без неё 1 (максимум, см. `elevationPeakPercentile`). */
  peakPercentile?: number
}

/** Вид входа: bump/diffuse — синтез рельефа, elevation — честная карта высот (яркость = высота). */
type BodyInputKind = 'bump' | 'diffuse' | 'elevation'

const TEXTURES_ROOT = 'storage/images/textures/planets'

/**
 * Список генераций — изначально см. «Список генераций (12 уникальных карт →
 * 18 тел)» в плане арки (`docs/superpowers/plans/2026-08-16-terrain-moons-batch.md`);
 * фикс-раунд 1 (находка 2, рулинг контроллера) развёл общую карту Корribана
 * на семь ПЕР-ТЕЛО генераций — общий бюджет 0.7% радиуса I (1740 км),
 * откалиброванный под неё height/slope, давал VII (175 км) 577% ЕЁ бюджета.
 * Пути и радиусы — константы из инвентаризации/resources.ts, БД не читается.
 * Тела с водой (waterLevelMeters в БД — Земля, Явин IV) сюда НЕ входят: их
 * slope-карта несёт канал A и собирается только `build:slopemaps-all`.
 */
const BODIES: readonly BodyGeneration[] = [
  {
    // Настоящая карта высот владельца (16384×8192, яркость = высота) — путь elevation вместо синтеза из диффуза; блочность JPEG-происхождения — σ 2.0, 41% дисперсии шире 560 км — highPassKm 600.
    name: 'io',
    inputPath: `${TEXTURES_ROOT}/io/io_elevation_16k.png`,
    inputKind: 'elevation',
    radiusMeters: 1_821_500,
    seedActorId: 20,
    actorIds: [20],
    smoothSigmaTexels: 2.0,
    highPassKm: 600,
    peakPercentile: 0.999
  },
  {
    // Настоящая карта высот (= ganymede_bump, корреляция 0.999) — путь elevation вместо синтеза из диффуза; пик занижен до 6000 м (реальный рельеф Ганимеда ±1-2 км, бюджет 18.4 км неправдоподобен); highPassKm 800 — половина дисперсии карты на масштабах шире 800 км (широкие светлые/тёмные пятна), без фильтра съедала бы бюджет высоты у кратеров/борозд; peakPercentile 0.999 — верхние 0.1% текселей задавали половину амплитуды нормировки, не типичный рельеф.
    name: 'ganymede',
    inputPath: `${TEXTURES_ROOT}/ganymede/ganymede_elevation_11k.png`,
    inputKind: 'elevation',
    radiusMeters: 2_631_200,
    seedActorId: 22,
    actorIds: [22],
    smoothSigmaTexels: 1.0,
    peakMeters: 6_000,
    highPassKm: 800,
    peakPercentile: 0.999
  },
  {
    name: 'rhea',
    inputPath: `${TEXTURES_ROOT}/rhea/rhea_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 764_500,
    seedActorId: 28,
    actorIds: [28]
  },
  {
    name: 'titan',
    inputPath: `${TEXTURES_ROOT}/titan/titan_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 2_575_000,
    seedActorId: 29,
    actorIds: [29]
  },
  {
    name: 'iapetus',
    inputPath: `${TEXTURES_ROOT}/iapetus/iapetus.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 734_500,
    seedActorId: 30,
    actorIds: [30]
  },
  {
    name: 'triton',
    inputPath: `${TEXTURES_ROOT}/triton/triton_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 1_352_600,
    seedActorId: 36,
    actorIds: [36]
  },
  {
    // Настоящая карта высот (= charon_bump_16k, корреляция 1.0) — путь elevation вместо синтеза; 111 уровней яркости, ступени вдвое грубее обычного.
    name: 'charon',
    inputPath: `${TEXTURES_ROOT}/charon/charon_elevation_16k.png`,
    inputKind: 'elevation',
    radiusMeters: 606_000,
    seedActorId: 37,
    actorIds: [37],
    ceilingWidth: 4096,
    smoothSigmaTexels: 1.0
  },
  {
    // Та же карта, что была bump-входом, — путь elevation вместо синтеза; вход зернистый (44% энергии мельче 8 px).
    name: 'dysnomia',
    inputPath: `${TEXTURES_ROOT}/dysnomia/dysnomia_elevation_16k.png`,
    inputKind: 'elevation',
    radiusMeters: 320_000,
    seedActorId: 38,
    actorIds: [38],
    ceilingWidth: 4096,
    smoothSigmaTexels: 2.0
  },
  {
    name: 'adriana3',
    inputPath: `${TEXTURES_ROOT}/StarWars/adriana3/adriana3_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 2_256_760,
    seedActorId: 73,
    actorIds: [73]
  },
  {
    name: 'ohann3',
    inputPath: `${TEXTURES_ROOT}/unnamed/unnamed_planet_7.png`,
    inputKind: 'diffuse',
    radiusMeters: 347_190,
    seedActorId: 70,
    actorIds: [70]
  },
  // Korriban I-VII делят один физический вход (actorResource.ts переиспользует
  // resourceId 117/118 для actorId 93-99), но КАЖДОЕ тело — своя генерация:
  // общий выход, откалиброванный под радиус I, перегружал бюджет высоты
  // мелких тел семьи (см. докблок модуля, находка 2). Радиусы — инвентаризация.
  {
    name: 'korriban1',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 1_740_000,
    seedActorId: 93,
    actorIds: [93]
  },
  {
    name: 'korriban2',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 980_000,
    seedActorId: 94,
    actorIds: [94]
  },
  {
    name: 'korriban3',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 1_290_000,
    seedActorId: 95,
    actorIds: [95]
  },
  {
    name: 'korriban4',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 640_000,
    seedActorId: 96,
    actorIds: [96]
  },
  {
    name: 'korriban5',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 410_000,
    seedActorId: 97,
    actorIds: [97]
  },
  {
    name: 'korriban6',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 240_000,
    seedActorId: 98,
    actorIds: [98]
  },
  {
    name: 'korriban7',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/i/i_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 175_000,
    seedActorId: 99,
    actorIds: [99]
  },
  // Карликовые планеты пояса Койпера/рассеянного диска — вход diffuse (DEM
  // нет), потолок разрешения 4096 у всех пяти (500–1500 км по resolutionCeiling).
  {
    // Единственное тело батча с настоящей картой высот (16384×8192, яркость =
    // высота): ни подложки, ни полосы — и потолок поднят до 8192 вместо 4096
    // по радиусу, вход это оправдывает. Файл локальный, в git не хранится.
    name: 'pluto',
    inputPath: `${TEXTURES_ROOT}/pluto/pluto_elevation_16k.png`,
    inputKind: 'elevation',
    radiusMeters: 1_188_300,
    seedActorId: 14,
    actorIds: [14],
    ceilingWidth: 8192
  },
  {
    // Вход — обработанная мозаика 20k владельца (яркость = высота); пик занижен
    // относительно бюджета осознанно (рельеф Европы — сотни метров).
    name: 'europa',
    inputPath: `${TEXTURES_ROOT}/europa/europa_elevation_20k.png`,
    inputKind: 'elevation',
    radiusMeters: 1_561_000,
    seedActorId: 21,
    actorIds: [21],
    ceilingWidth: 8192,
    peakMeters: 1800
  },
  {
    name: 'haumea',
    inputPath: `${TEXTURES_ROOT}/haumea/haumea.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 816_000,
    seedActorId: 15,
    actorIds: [15]
  },
  {
    name: 'makemake',
    inputPath: `${TEXTURES_ROOT}/makemake/makemake.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 739_000,
    seedActorId: 16,
    actorIds: [16]
  },
  {
    // Вход зернистый (35% энергии мельче 4 px) — σ 1.5 против зерна, сильнее дефолта.
    name: 'eris',
    inputPath: `${TEXTURES_ROOT}/eris/eris_elevation_16k.png`,
    inputKind: 'elevation',
    radiusMeters: 1_163_000,
    seedActorId: 17,
    actorIds: [17],
    ceilingWidth: 8192,
    smoothSigmaTexels: 1.5
  },
  {
    // Настоящая карта высот владельца (16384×8192, яркость = высота) — путь elevation вместо синтеза из диффуза; зернистый вход (51% энергии мельче 8 px) — σ 2.0 против зерна.
    name: 'sedna',
    inputPath: `${TEXTURES_ROOT}/sedna/sedna_elevation_16k.png`,
    inputKind: 'elevation',
    radiusMeters: 800_000,
    seedActorId: 18,
    actorIds: [18],
    smoothSigmaTexels: 2.0
  },
  // Арка terrain-standardization (Task 1) — финальные 19 твёрдых тел без DEM:
  // луны Сатурна/Урана, оставшиеся тела Звёздных Войн и безымянные планеты.
  // Радиусы/входы/потолки — таблица плана арки; потолок у всех, кроме
  // Adriana IV и Коррибана, совпадает с автовычисленным `resolutionCeiling`
  // (не форсируется отдельно). Мимас/Тефия/Гуермесса/Ченини — источники не
  // делятся нацело на потолок, тянут нецелый скейл в `boxDownsampleGreyscale`
  // (обобщён под area-average с дробным перекрытием, см. `batchBodyRules.ts`).
  {
    name: 'mimas',
    inputPath: `${TEXTURES_ROOT}/mimas/mimas.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 198_800,
    seedActorId: 24,
    actorIds: [24]
  },
  {
    name: 'tethys',
    inputPath: `${TEXTURES_ROOT}/tethys/tethys.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 536_300,
    seedActorId: 26,
    actorIds: [26]
  },
  {
    // Настоящая карта высот владельца (18928×9464, яркость = высота) — путь elevation вместо синтеза из диффуза.
    name: 'dione',
    inputPath: `${TEXTURES_ROOT}/dione/dione_elevation_18k.png`,
    inputKind: 'elevation',
    radiusMeters: 562_500,
    seedActorId: 27,
    actorIds: [27],
    ceilingWidth: 4096
  },
  {
    name: 'miranda',
    inputPath: `${TEXTURES_ROOT}/miranda/miranda.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 240_000,
    seedActorId: 31,
    actorIds: [31]
  },
  {
    name: 'ariel',
    inputPath: `${TEXTURES_ROOT}/ariel/ariel_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 577_900,
    seedActorId: 32,
    actorIds: [32]
  },
  {
    name: 'umbriel',
    inputPath: `${TEXTURES_ROOT}/umbriel/umbriel_bump.jpg`,
    inputKind: 'bump',
    radiusMeters: 585_000,
    seedActorId: 33,
    actorIds: [33]
  },
  {
    name: 'titania',
    inputPath: `${TEXTURES_ROOT}/titania/titania.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 788_900,
    seedActorId: 34,
    actorIds: [34]
  },
  {
    name: 'oberon',
    inputPath: `${TEXTURES_ROOT}/oberon/oberon.jpg`,
    inputKind: 'diffuse',
    radiusMeters: 761_500,
    seedActorId: 35,
    actorIds: [35]
  },
  {
    name: 'tatooine',
    inputPath: `${TEXTURES_ROOT}/StarWars/tatooine/tatooine.png`,
    inputKind: 'diffuse',
    radiusMeters: 5_232_000,
    seedActorId: 62,
    actorIds: [62]
  },
  {
    name: 'ghomrassen',
    inputPath: `${TEXTURES_ROOT}/StarWars/ghomrassen/ghomrassen.png`,
    inputKind: 'diffuse',
    radiusMeters: 520_790,
    seedActorId: 65,
    actorIds: [65]
  },
  {
    name: 'guermessa',
    inputPath: `${TEXTURES_ROOT}/StarWars/guermessa/guermessa.png`,
    inputKind: 'diffuse',
    radiusMeters: 468_712,
    seedActorId: 66,
    actorIds: [66]
  },
  {
    name: 'chenini',
    inputPath: `${TEXTURES_ROOT}/StarWars/chenini/chenini.png`,
    inputKind: 'diffuse',
    radiusMeters: 364_554,
    seedActorId: 67,
    actorIds: [67]
  },
  // Ohann I и Adriana IV делят один физический вход (unnamed_planet_5.png),
  // но КАЖДЫЙ — своя генерация со своим сидом (та же причина, что у Коррибана
  // выше): общие выходы пишутся под разными именами (`dirname(input)` один,
  // `<ключ>_height.raw`/`_slope.webp` — разные).
  {
    name: 'ohann1',
    inputPath: `${TEXTURES_ROOT}/unnamed/unnamed_planet_5.png`,
    inputKind: 'diffuse',
    radiusMeters: 1_215_179,
    seedActorId: 68,
    actorIds: [68]
  },
  {
    name: 'ohann2',
    inputPath: `${TEXTURES_ROOT}/unnamed/unnamed_planet_6.png`,
    inputKind: 'diffuse',
    radiusMeters: 867_985,
    seedActorId: 69,
    actorIds: [69]
  },
  {
    name: 'adriana1',
    inputPath: `${TEXTURES_ROOT}/unnamed/unnamed_planet_1.png`,
    inputKind: 'diffuse',
    radiusMeters: 1_388_776,
    seedActorId: 71,
    actorIds: [71]
  },
  {
    name: 'adriana2',
    inputPath: `${TEXTURES_ROOT}/unnamed/unnamed_planet_3.png`,
    inputKind: 'diffuse',
    radiusMeters: 1_041_582,
    seedActorId: 72,
    actorIds: [72]
  },
  {
    // Тот же вход, что у Ohann I (unnamed_planet_5.png) — источник 3072×1536
    // меньше потолка 8192, разрешение ограничится исходным (штатно, потолок
    // не форсируется), см. докблок выше.
    name: 'adriana4',
    inputPath: `${TEXTURES_ROOT}/unnamed/unnamed_planet_5.png`,
    inputKind: 'diffuse',
    radiusMeters: 1_701_251,
    seedActorId: 74,
    actorIds: [74]
  },
  {
    // Источник 4096×2048 меньше потолка 8192 — разрешение ограничится
    // исходным (штатно, потолок не форсируется).
    name: 'korriban',
    inputPath: `${TEXTURES_ROOT}/StarWars/korriban/korriban_bump.png`,
    inputKind: 'bump',
    radiusMeters: 5_950_000,
    seedActorId: 88,
    actorIds: [88]
  }
]

interface ReportRow {
  name: string
  actorIds: readonly number[]
  inputPath: string
  inputKind: BodyInputKind
  width: number
  height: number
  amplitudeMeters: number
  rmsTan: number
  peakMeters: number
  budgetMeters: number
  minMeters: number
  maxMeters: number
  /** Отчётный флаг: пик-рескейл (peakClamped) ИЛИ подгонка амплитуды упёрлась в потолок бюджета (amplitudeClamped) — любой из двух означает, что число в колонке «RMS(tan)» не свободная подгонка к цели. */
  clamped: boolean
  /** Пост-коррекция сработала: фактический пик поля после калибровки превышал бюджет высоты, bump+подложка рескейлены одной повторной генерацией. */
  peakClamped: boolean
  /** `autoCalibrateAmplitude` сама упёрлась в потолок 0.7% радиуса ещё на подгонке параметра — RMS цели 0.05–0.09 не достигнут (спековый случай «RMS недостигнут, потолок амплитуды»), независимо от peakClamped. */
  amplitudeClamped: boolean
  iterations: number
  heightPath: string
  slopePath: string
  heightBytes: number
  slopeVramMiB: number
}

/** Фактический пик поля высот — max(|min|,|max|), честная величина для сверки с бюджетом (не амплитуда-параметр). */
function peakMetersOf(map: HeightMapData): number {
  return Math.max(Math.abs(map.minMeters), Math.abs(map.maxMeters))
}

/**
 * Вход → яркость [0..1] в целевом (даунсемпленном) разрешении. 2:1 проверяется
 * до ресемпла — источник должен быть честной эквиректангулярной картой.
 * Ресемпл (`boxDownsampleGreyscale`) — только если целевая ширина меньше
 * исходной (без апсемпла).
 */
async function loadDownsampledGreyscale(
  inputPath: string,
  ceilingWidth: number
): Promise<{ width: number; height: number; luminance: Float64Array }> {
  const metadata = await sharp(inputPath, { limitInputPixels: false }).metadata()
  const sourceWidth = metadata.width
  const sourceHeight = metadata.height

  if (!sourceWidth || !sourceHeight) {
    throw new Error(`Не удалось прочитать размеры входа: ${inputPath}`)
  }
  if (sourceWidth !== 2 * sourceHeight) {
    throw new Error(`Вход должен быть 2:1 (ширина=2×высота), получено ${sourceWidth}×${sourceHeight}: ${inputPath}`)
  }

  const width = Math.min(sourceWidth, ceilingWidth)
  const height = width / 2

  const { data } = await sharp(inputPath, { limitInputPixels: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const luminance =
    width < sourceWidth ? boxDownsampleGreyscale(data, sourceWidth, sourceHeight, width, height) : normalizeBytes(data)

  return { width, height, luminance }
}

/** Байты [0..255] → яркость [0..1], без ресемпла. */
function normalizeBytes(data: Buffer): Float64Array {
  const out = new Float64Array(data.length)
  for (let i = 0; i < out.length; i++) out[i] = data[i] / 255

  return out
}

// measureRmsTan и synthesizeHeightAndSlope (синтез поля высот → нормировка →
// slope-карта → замер RMS(tan), { cavity } пробрасывается в buildSlopeMap) —
// вынесены в scripts/lib/synthesizeSlope.ts: без файлового ввода-вывода,
// тестируемы напрямую (tests/scripts/synthesizeSlope.spec.ts), докблоки там.

/**
 * Поле высот тела до записи файлов — общий результат обоих видов входа.
 * slope-карта прогонов сюда не попадает: финальная всё равно пересобирается
 * с cavity и slopeRange своей строки БД (см. `generateBody`).
 */
interface BodyField {
  map: HeightMapData
  amplitudeMeters: number
  rmsTan: number
  peakMeters: number
  peakClamped: boolean
  amplitudeClamped: boolean
  iterations: number
}

/**
 * Вход `elevation`: карта высот честная, поэтому ни автокалибровки по RMS, ни
 * пост-коррекции по пику (`peakClamped`/`amplitudeClamped` этого пути всегда
 * `false` — иной кламп, см. ниже) — амплитуда равна `peakMeters` по
 * построению (`buildElevationHeightField` нормирует пик ровно на него —
 * бюджет тела по умолчанию, либо явная ручка `body.peakMeters`, см.
 * `elevationPeakMeters`), а RMS(tan) — отчётная величина, а не цель подгонки.
 *
 * `body.highPassKm` (км волны) переводится в тексели экватора той же
 * формулой, что и края band-фильтра bump-входа (`equatorTexelMeters` —
 * длина экваториальной дуги на тексель ВЫХОДНОГО разрешения), см.
 * `elevationHighPassSigmaTexels`. `body.peakPercentile` (0.9..1, дефолт 1) —
 * квантиль нормировки пика вместо абсолютного максимума; при p<1
 * `buildElevationHeightField` сама клампит превышение в ±`peakMeters`
 * (внутренний кламп функции, НЕ `peakClamped` этой генерации).
 */
function elevationField(
  body: BodyGeneration,
  luminance: Float64Array,
  width: number,
  height: number,
  peakMeters: number
): BodyField {
  const smoothSigmaTexels = elevationSmoothSigmaTexels(ELEVATION_SMOOTH_SIGMA_TEXELS, body.smoothSigmaTexels)
  const equatorTexelMeters = (2 * Math.PI * body.radiusMeters) / width
  const highPassSigmaTexels = elevationHighPassSigmaTexels(equatorTexelMeters, body.highPassKm)
  const peakPercentile = elevationPeakPercentile(body.peakPercentile)

  // { cavity: false }: полость B пересчитывается единственным финальным
  // проходом ниже, здесь она была бы чистой потерей времени (как и в калибровке).
  const result = synthesizeElevationHeightAndSlope(
    luminance,
    width,
    height,
    body.radiusMeters,
    peakMeters,
    smoothSigmaTexels,
    highPassSigmaTexels,
    peakPercentile,
    { cavity: false }
  )

  return {
    map: result.map,
    amplitudeMeters: peakMeters,
    rmsTan: result.rmsTan,
    peakMeters: peakMetersOf(result.map),
    peakClamped: false,
    amplitudeClamped: false,
    iterations: 0
  }
}

/** Входы `bump`/`diffuse`: синтез рельефа с автокалибровкой амплитуды и пост-коррекцией по пику. */
function calibratedField(
  body: BodyGeneration,
  luminance: Float64Array,
  width: number,
  height: number,
  maxHeightBudgetMeters: number
): BodyField {
  const bandLowKm = bandLowKmFor(body.radiusMeters)
  const equatorTexelKm = (2 * Math.PI * body.radiusMeters) / width / 1000
  const bandHighKm = BAND_HIGH_TEXELS * equatorTexelKm

  let last: HeightMapData | undefined

  // { cavity: false }: калибровка меряет только RMS(tan) (R/G), полость
  // канала B тут не читается и была бы чистой потерей времени на каждой из
  // до 3 итераций (см. докблок synthesizeHeightAndSlope).
  const generate = (bumpAmplitudeMeters: number): CalibrationSample => {
    const result = synthesizeHeightAndSlope(
      luminance,
      width,
      height,
      body.radiusMeters,
      body.seedActorId,
      bandLowKm,
      bandHighKm,
      BASE_AMPLITUDE_METERS,
      bumpAmplitudeMeters,
      { cavity: false }
    )
    last = result.map

    return { rmsTan: result.rmsTan, peakMeters: peakMetersOf(result.map) }
  }

  const calibration = autoCalibrateAmplitude(generate, REF_AMPLITUDE_METERS, TARGET_RMS_TAN, maxHeightBudgetMeters)

  // autoCalibrateAmplitude всегда зовёт generate минимум раз — last заполнен гарантированно
  if (!last) throw new Error(`Автокалибровка ${body.name}: колбэк ни разу не вызван`)

  let finalAmplitudeMeters = calibration.amplitudeMeters
  let finalRmsTan = calibration.rmsTan
  let finalPeakMeters = calibration.peakMeters
  let peakClamped = false

  // Пост-коррекция по фактическому пику поля (фикс-раунд 1, находка 1):
  // autoCalibrateAmplitude клампит только ПАРАМЕТР bump-амплитуды, подложка
  // (BASE_AMPLITUDE_METERS) в неё не входит — реальный max(|min|,|max|) может
  // превысить бюджет даже когда bump-амплитуда в рамках (типично для малых
  // тел: константная подложка — заметная доля их крошечного бюджета).
  // buildSynthHeightField однородна по паре амплитуд: heights[i] =
  // base·baseAmplitude + band[i]·bumpAmplitude — оба слагаемых линейны по
  // СВОЕЙ амплитуде без свободного члена, поэтому синхронный рескейл ОБЕИХ
  // на один и тот же коэффициент масштабирует min/max РОВНО на этот
  // коэффициент: одна повторная генерация точно возвращает пик на бюджет,
  // без итерационного поиска.
  if (finalPeakMeters > maxHeightBudgetMeters) {
    const rescale = maxHeightBudgetMeters / finalPeakMeters
    finalAmplitudeMeters = calibration.amplitudeMeters * rescale
    const rescaledBaseAmplitudeMeters = BASE_AMPLITUDE_METERS * rescale

    // { cavity: false }: этот прогон тоже только меряет rmsTan/peakMeters
    // рескейленного поля — записываемый B ниже строится отдельным проходом.
    const result = synthesizeHeightAndSlope(
      luminance,
      width,
      height,
      body.radiusMeters,
      body.seedActorId,
      bandLowKm,
      bandHighKm,
      rescaledBaseAmplitudeMeters,
      finalAmplitudeMeters,
      { cavity: false }
    )
    last = result.map
    finalRmsTan = result.rmsTan
    finalPeakMeters = peakMetersOf(result.map)
    peakClamped = true
  }

  return {
    map: last,
    amplitudeMeters: finalAmplitudeMeters,
    rmsTan: finalRmsTan,
    peakMeters: finalPeakMeters,
    peakClamped,
    // фикс-раунд 2, находка 5: тело могло упереться в потолок ещё на подгонке
    // амплитуды (RMS цели не достигнут) без единого следа в отчёте, если пик
    // поля после этого бюджет повторно не превысил.
    amplitudeClamped: calibration.clamped,
    iterations: calibration.iterations
  }
}

/** Полная генерация одного тела: даунсемпл → поле высот → запись height+slope → строка отчёта. */
async function generateBody(body: BodyGeneration): Promise<ReportRow> {
  const ceilingWidth = resolutionCeiling(body.radiusMeters, body.ceilingWidth)
  const { width, height, luminance } = await loadDownsampledGreyscale(body.inputPath, ceilingWidth)
  const maxHeightBudgetMeters = HEIGHT_BUDGET_FRACTION * body.radiusMeters

  const field =
    body.inputKind === 'elevation'
      ? elevationField(body, luminance, width, height, elevationPeakMeters(body.radiusMeters, body.peakMeters))
      : calibratedField(body, luminance, width, height, maxHeightBudgetMeters)

  // Единственный проход с полостью (находка фикс-волны 3): прогоны выше
  // сознательно считали R/G без cavity — здесь собираем финальную slope-карту
  // ОДИН раз с cavity: true, на уже готовой карте высот field.map — без
  // повторного синтеза поля.
  const dir = path.dirname(body.inputPath)
  const heightPath = path.join(dir, `${body.name}_height.raw`)
  const slopePath = path.join(dir, `${body.name}_slope.webp`)

  // финальная карта кодируется диапазоном своей строки ресурса — иначе байты
  // на диске разойдутся с uSlopeRange шейдера; прогоны выше намеренно
  // остаются на дефолте (measureRmsTan декодирует им же).
  const dbSlopePath = dbPathFor(slopePath, path.dirname(TEXTURES_ROOT))
  const slopeRgb = buildSlopeMap(field.map, body.radiusMeters, {
    slopeRange: slopeRangeForPath(dbSlopePath, Resources)
  })

  await writeFile(heightPath, encodeHeightMap(field.map))
  await sharp(Buffer.from(slopeRgb.buffer), { raw: { width, height, channels: 3 } })
    .webp({ lossless: true, effort: 6, exact: true })
    .toFile(slopePath)

  return {
    name: body.name,
    actorIds: body.actorIds,
    inputPath: body.inputPath,
    inputKind: body.inputKind,
    width,
    height,
    amplitudeMeters: field.amplitudeMeters,
    rmsTan: field.rmsTan,
    peakMeters: field.peakMeters,
    budgetMeters: maxHeightBudgetMeters,
    minMeters: field.map.minMeters,
    maxMeters: field.map.maxMeters,
    clamped: field.peakClamped || field.amplitudeClamped,
    peakClamped: field.peakClamped,
    amplitudeClamped: field.amplitudeClamped,
    iterations: field.iterations,
    heightPath,
    slopePath,
    heightBytes: 24 + width * height * 2, // заголовок TEHM + uint16 тело
    slopeVramMiB: (width * height * 4 * (4 / 3)) / (1024 * 1024) // RGBA8 + мип-цепочка ×4/3
  }
}

async function run(): Promise<void> {
  const onlyName = argument('only')
  const selected = onlyName ? BODIES.filter((body) => body.name === onlyName) : BODIES

  if (onlyName && selected.length === 0) {
    console.error(`--only ${onlyName}: генерация не найдена. Доступные: ${BODIES.map((body) => body.name).join(', ')}`)
    process.exit(1)
  }

  const rows: ReportRow[] = []

  for (const body of selected) {
    console.log(`Генерация ${body.name} (${body.inputKind}: ${body.inputPath})…`)
    const row = await generateBody(body)
    rows.push(row)

    console.log(
      `  ${row.width}×${row.height} (вход ${row.inputKind}), амплитуда ${row.amplitudeMeters.toFixed(0)} м (${row.iterations} прогонов калибровки` +
        `${row.peakClamped ? ' + рескейл под пик' : ''}), RMS(tan) ${row.rmsTan.toFixed(4)}, ` +
        `пик ${row.peakMeters.toFixed(0)} м / бюджет ${row.budgetMeters.toFixed(0)} м` +
        `${row.peakClamped ? ' [КЛАМП: пик поля превышал бюджет — bump и подложка рескейлены]' : ''}` +
        `${row.amplitudeClamped ? ' [АМПЛИТУДА НА ПОТОЛКЕ: RMS цель недостигнута, подгонка упёрлась в бюджет]' : ''}, ` +
        `высоты ${row.minMeters.toFixed(0)}..${row.maxMeters.toFixed(0)} м`
    )
  }

  console.log('\nСводная таблица:')
  console.table(
    rows.map((row) => ({
      генерация: row.name,
      тело: row.actorIds.join(','),
      вход: row.inputKind,
      разрешение: `${row.width}×${row.height}`,
      'амплитуда, м': Math.round(row.amplitudeMeters),
      'RMS(tan)': row.rmsTan.toFixed(4),
      'пик, м': Math.round(row.peakMeters),
      'бюджет, м': Math.round(row.budgetMeters),
      'высоты, м': `${row.minMeters.toFixed(0)}..${row.maxMeters.toFixed(0)}`,
      'height, МиБ': (row.heightBytes / (1024 * 1024)).toFixed(2),
      'slope VRAM, МиБ': row.slopeVramMiB.toFixed(2),
      кламп: row.clamped ? 'да' : ''
    }))
  )

  // Каждая генерация теперь пишет СВОЙ физический файл (Корribан I-VII —
  // тоже, фикс-раунд 1, находка 2) — дедуп не нужен, прямая сумма по строкам.
  const totalSlopeVramMiB = rows.reduce((sum, row) => sum + row.slopeVramMiB, 0)
  const totalHeightMiB = rows.reduce((sum, row) => sum + row.heightBytes, 0) / (1024 * 1024)
  console.log(`\nИтого: slope VRAM ${totalSlopeVramMiB.toFixed(2)} МиБ, height CPU ${totalHeightMiB.toFixed(2)} МиБ`)

  console.log('\nПути для заливки в бакет (пара height+slope на генерацию):')
  for (const row of rows) {
    console.log(`  ${row.heightPath}`)
    console.log(`  ${row.slopePath}`)
  }
}

await run()
