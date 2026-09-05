import { Frustum, Sphere, Vector3 } from 'three'
import { SpaceScale } from '@/core/constants'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { WATER_SHALLOW_RANGE_METERS } from './waterLevel'
import { CUBE_FACES, cubeFaceDirection } from './cubeSphere'
import type { TerrainHeightField } from './TerrainHeightField'

/** Адрес узла квадродерева грани кубосферы: (face, level, i, j). level 0 — целая грань, не адресуется наружу. */
export type TerrainNodeAddress = { face: number; level: number; i: number; j: number }

/**
 * Числовой ключ узла: face(3 бита)|level(4)|i(8)|j(8) — 23 бита, SMI.
 * Диапазоны: face 0..5, level 0..TERRAIN_QUADTREE_MAX_LEVEL(8), i/j 0..255
 * (2^level патчей на грани, level=8 ⇒ 256). Раскладка была 3|3|6|6 (18 бит,
 * i/j 0..63) под MAX_LEVEL=6 — подъём до 8 требует i/j до 255 (8 бит), старая
 * раскладка бы молча коллизировала (i=64 задевает бит level). Ключ строковым
 * был источником 74 880 строковых аллокаций/кадр в дифе покрытия (ревью
 * 2026-08-17, перф-долг №5/№10) — Map/Set по числу их не платят.
 */
export const terrainNodeKey = (a: TerrainNodeAddress): number => (a.face << 20) | (a.level << 16) | (a.i << 8) | a.j

/** Ниже этого уровня узел спускается безусловно — минимальный набор всегда 6·4^MIN_LEVEL листьев. */
export const TERRAIN_QUADTREE_MIN_LEVEL = 1

/**
 * Глубже этого уровня спуск не идёт даже при недостижимом SSE-пороге.
 * У поверхности потолок ДОСТИГАЕТСЯ — это не страховка «на всякий случай»:
 * ближний план держит листья ровно на нём, запас глубины нужен под
 * геометрию средней полосы (её волны короче шага модели, см.
 * `TERRAIN_MODEL_LEVEL`). Модель провиса/клиренса и пер-узловые пирамиды
 * калиброваны мельче этого потолка — консервативно, см. `TERRAIN_MODEL_LEVEL`.
 */
export const TERRAIN_QUADTREE_MAX_LEVEL = 8

/**
 * Уровень калибровки модели провиса/клиренса (`TerrainHeightField`:
 * `equatorStepTexels`, окно кривизнной суммы, сетка клиренса) и глубина
 * пер-узловых пирамид (`nodeMaxHeightMeters`/`nodeGeometricErrorMeters`) и
 * `levelErrorMeters` — прежний потолок квадродерева. Запечённые компаньоны
 * (`.aux`) посчитаны на этом уровне и остаются валидными при более глубоком
 * `TERRAIN_QUADTREE_MAX_LEVEL`: отбор узлов спускается глубже, а геометрия
 * модели продолжает считаться так, будто дно дерева — здесь (консервативно:
 * провис уровня `TERRAIN_MODEL_LEVEL` заведомо не меньше провиса более
 * глубокого уровня). Уровни глубже него получают ε экстраполяцией степенным
 * законом (см. `TerrainHeightField.extrapolatedLevelErrorMeters`) и честный
 * максимум узла — от предка на этом уровне (тоже консервативно).
 */
export const TERRAIN_MODEL_LEVEL = 6

/** Клирофф дистанции у камеры на/под поверхностью — иначе sse делится на почти-ноль и уходит в бесконечность. */
const MIN_DISTANCE_METERS = 100

/**
 * Потолок глубины подводных патчей суши (Task 5, water-foundation): узел на
 * этом уровне или глубже, чей ЧЕСТНЫЙ максимум высоты (`TerrainHeightField.nodeMaxHeightMeters`,
 * пирамида честных per-node максимумов — не статистика) уверенно ниже уровня
 * воды, дальше не делится — цель: океанские патчи не глубже ~L4 (не
 * TERRAIN_QUADTREE_MAX_LEVEL=8). Ниже этого уровня потолок не действует —
 * береговые/мелководные узлы обязаны домешаться честно на общих основаниях
 * (SSE), запрет применяется только к уже достаточно мелким узлам, где
 * визуальная разница под непрозрачной водой всё равно не видна.
 *
 * Раньше здесь была статистическая оценка «центр+k·ε» — снята ревью Task 5,
 * фикс-раунд 1, находка №1 (БЛОКЕР): недооценка максимума узла до 7.4 км на
 * реальной карте (узел L4 с Гавайями), 211 замороженных прибрежных узлов с
 * видимой сушей выше уровня; смешанный узел (центр в океане, остров у края)
 * — необнаружимый случай для формулы «центр+k·ε» ни при каком k (просканировано).
 */
export const TERRAIN_QUADTREE_WATER_CEILING_LEVEL = 4

/**
 * Запас потолка, метры — честный максимум узла (`nodeMaxHeightMeters`) сам
 * по себе уже не занижает (см. её докблок и докблок билдера пирамиды в
 * TerrainHeightField), запас здесь на то, чтобы замораживать узел ТОЛЬКО под
 * непрозрачной водой. `= WATER_SHALLOW_RANGE_METERS` (диапазон мелководья
 * канала A slope-карты, см. её докблок) — было 50 м, что уже ЗАКОРОЧЕ
 * 200-метрового диапазона мелководья энкодера: узел мог замёрзнуть на уровне
 * L4, чей честный максимум лежит между 50 и 200 м под водой — то есть под
 * ещё ЧАСТИЧНО прозрачной водой, гранёный шельф был виден сквозь неё (находка
 * №1 финального ревью, замер: 60 шельфовых L4-узлов Земли, самый мелкий
 * −51.6 м при альфе 0.22 из 0.85). Запас потолка обязан быть ≥ диапазона
 * мелководья — тогда заморозка начинается не раньше полностью непрозрачной
 * глубины.
 */
const WATER_CEILING_MARGIN_METERS = WATER_SHALLOW_RANGE_METERS

export interface SelectParams {
  field: TerrainHeightField
  cameraLocal: Vector3 // юниты, теле-фиксированный фрейм
  frustumLocal: Frustum | null // null = без фрустум-гейта (тесты)
  screenHeight: number // px
  fovYRadians: number
  splitPixels: number // ручка terrain.sseSplitPixels
  mergeFactor: number // ручка terrain.sseMergeFactor
  currentlySplit: ReadonlySet<number> // ключи узлов (terrainNodeKey), разбитых в прошлом кадре
  /**
   * Уровень воды тела, метры (Task 5, water-foundation) — ручка актора, не
   * поля (см. докблок `TerrainHeightField`/`CameraCollision.Collider`).
   * Отсутствие — потолок подводных патчей не действует, отбор бит-в-бит
   * прежний.
   */
  waterLevelMeters?: number
}

// Скретчи модуля: функция зовётся каждый кадр, аллокаций на ПОСЕЩЁННЫЙ узел
// быть не должно (ключ — число, не строка). Единственная аллокация на вызов —
// объект адреса на каждый ЛИСТ (leaves.push) и возвращаемые leaves/split.
// Recursion синхронна и глубину узла не переиспользует после ветвления — общие
// скретчи безопасны между уровнями.
const centerDirScratch = new Vector3()
const sphereCenterScratch = new Vector3()
const sphereScratch = new Sphere()

/**
 * Стретч диагонали ячейки равноугольной развёртки у угла грани относительно
 * центра: √(4/3). Радиус сферы узла обязан покрывать ХУДШИЙ узел уровня —
 * иначе частично видимый угловой узел признаётся невидимым и не сплитится.
 */
const CORNER_DIAGONAL_STRETCH = Math.sqrt(4 / 3)

/**
 * Радиус ограничивающей сферы узла (юниты) с центром на R + h(центр):
 * полудиагональ дуги патча с угловым стретчем + размах высот карты
 * ОТНОСИТЕЛЬНО высоты центра (не |min|/|max| от датума).
 *
 * Дуга меряется по сфере ВЕРШИН (R + max), а не по датуму: хорда той же
 * угловой ширины на радиусе R + h длиннее в (R + h)/R раз. Впадины
 * (max ≤ 0) множителя не дают — сфера не должна сжиматься.
 */
export function nodeBoundingSphereRadiusUnits(field: TerrainHeightField, level: number, centerHeightMeters: number): number {
  const arcRadiusKm = field.radiusKm + Math.max(field.maxMeters, 0) / 1000
  const patchHalfDiagonal =
    ((toThreeJSUnits(arcRadiusKm) * (Math.PI / 2)) / 2 ** level) * (Math.SQRT2 / 2) * CORNER_DIAGONAL_STRETCH
  // + 2·maxAmplitude полосы (Task 5): полоса не привязана к сетке узлов
  // (аналитическая добавка поверх карты, см. докблок TerrainHeightField) —
  // тот же паттерн, что у архивных октав: глобальный потолок амплитуды на
  // каждый узел, а не per-node оценка
  const heightPadMeters =
    Math.max(field.maxMeters - centerHeightMeters, centerHeightMeters - field.minMeters, 0) +
    2 * (field.midband?.maxAmplitudeMeters ?? 0)

  return patchHalfDiagonal + toThreeJSUnits(heightPadMeters / 1000)
}

function visitNode(
  face: number,
  level: number,
  i: number,
  j: number,
  params: SelectParams,
  leaves: TerrainNodeAddress[],
  split: Set<number>
): void {
  if (level < TERRAIN_QUADTREE_MIN_LEVEL) {
    descend(face, level, i, j, params, leaves, split)
    return
  }

  const { field } = params
  // центр параметрического патча (s,t) на грани кубосферы, как в билдере RTC-геометрии
  const patches = 2 ** level
  const span = 2 / patches
  const sc = -1 + i * span + span / 2
  const tc = -1 + j * span + span / 2
  cubeFaceDirection(face, sc, tc, centerDirScratch)
  // mapHeightMeters(центр) — КАРТА без полосы:
  // пад радиуса узла (nodeBoundingSphereRadiusUnits) уже несёт глобальный
  // 2·maxAmplitude полосы, попиксельная оценка полосы в центре ничего не
  // добавляла к покрытию и стоила 0.8–1.4 мс/кадр/тело (3 октавы snoiseGrad3
  // на каждый посещённый узел каждый кадр). heightMeters(центр) один раз на
  // узел — раньше отдельно ещё раз читался потолком воды ниже (находка №6
  // ревью Task 5, фикс-раунд 1); surfaceRadiusUnits разворачивается вручную,
  // чтобы переиспользовать уже посчитанную высоту
  const centerHeightMeters = field.mapHeightMeters(centerDirScratch)
  sphereCenterScratch.copy(centerDirScratch).multiplyScalar(toThreeJSUnits(field.radiusKm + centerHeightMeters / 1000))

  const sphereRadius = nodeBoundingSphereRadiusUnits(field, level, centerHeightMeters)

  const minDistanceUnits = toThreeJSUnits(MIN_DISTANCE_METERS / 1000)
  const distance = Math.max(params.cameraLocal.distanceTo(sphereCenterScratch) - sphereRadius, minDistanceUnits)
  const distanceMeters = (distance / SpaceScale) * 1000

  const sse =
    (field.nodeGeometricErrorMeters(face, level, i, j) * params.screenHeight) /
    (2 * Math.tan(params.fovYRadians / 2) * distanceMeters)

  // раскладка бит совпадает с terrainNodeKey — считается без промежуточного
  // TerrainNodeAddress, чтобы не аллоцировать объект на каждый посещённый узел
  const key = (face << 20) | (level << 16) | (i << 8) | j
  const alreadySplit = params.currentlySplit.has(key)
  const threshold = alreadySplit ? params.splitPixels * params.mergeFactor : params.splitPixels

  let visible = true
  if (params.frustumLocal) {
    sphereScratch.center.copy(sphereCenterScratch)
    sphereScratch.radius = sphereRadius
    visible = params.frustumLocal.intersectsSphere(sphereScratch)
  }

  // Потолок подводных патчей суши (Task 5): считается только когда есть ручка
  // И узел уже достаточно мелкий (level >= WATER_CEILING_LEVEL) — без ручки
  // ни одного лишнего обращения к пирамиде на кадр, отбор бит-в-бит прежний.
  // Максимум узла — честный (`nodeMaxHeightMeters`, пирамида в TerrainHeightField,
  // O(1) массив), не статистика — см. докблок константы TERRAIN_QUADTREE_WATER_CEILING_LEVEL.
  let belowWaterCeiling = false
  if (params.waterLevelMeters !== undefined && level >= TERRAIN_QUADTREE_WATER_CEILING_LEVEL) {
    const nodeMaxHeightMeters = field.nodeMaxHeightMeters(face, level, i, j)
    belowWaterCeiling = nodeMaxHeightMeters < params.waterLevelMeters - WATER_CEILING_MARGIN_METERS
  }

  // Видимость гейтит только НОВЫЕ сплиты: уже разбитый узел держится по SSE
  // (merge-порог), иначе поворот камеры схлопывал бы поддерево до L1 и при
  // возврате в кадр требовал полной пересборки (бюджет времени terrain.lod.patchBuildBudgetMs).
  const shouldSplit =
    level < TERRAIN_QUADTREE_MAX_LEVEL && sse > threshold && (visible || alreadySplit) && !belowWaterCeiling

  if (shouldSplit) {
    split.add(key)
    descend(face, level, i, j, params, leaves, split)
  } else {
    leaves.push({ face, level, i, j })
  }
}

function descend(
  face: number,
  level: number,
  i: number,
  j: number,
  params: SelectParams,
  leaves: TerrainNodeAddress[],
  split: Set<number>
): void {
  const childLevel = level + 1

  for (let di = 0; di < 2; di++) {
    for (let dj = 0; dj < 2; dj++) {
      visitNode(face, childLevel, i * 2 + di, j * 2 + dj, params, leaves, split)
    }
  }
}

/**
 * Чистая функция отбора листьев квадродерева по экранной ошибке (SSE):
 * узел спускается пока `geometricErrorMeters(level)`, спроецированная в
 * пиксели, превышает порог (с гистерезисом между splitPixels и
 * splitPixels·mergeFactor) и его сфера видна во фрустуме. Уровни ниже
 * TERRAIN_QUADTREE_MIN_LEVEL спускаются безусловно, глубина не превышает
 * TERRAIN_QUADTREE_MAX_LEVEL. Без побочных эффектов, без обращения к сцене —
 * вызывается каждый кадр отдельно на CPU.
 */
export function selectTerrainNodes(params: SelectParams): { leaves: TerrainNodeAddress[]; split: Set<number> } {
  const leaves: TerrainNodeAddress[] = []
  const split = new Set<number>()

  for (let face = 0; face < CUBE_FACES; face++) {
    visitNode(face, 0, 0, 0, params, leaves, split)
  }

  return { leaves, split }
}

/** Результат обхода потомков: в поддереве нет желаемых / все желаемые живые / есть не живой. */
const enum DescendantsState {
  None,
  AllLive,
  NotLive
}

function descendantsState(
  face: number,
  level: number,
  i: number,
  j: number,
  wanted: ReadonlyMap<number, TerrainNodeAddress>,
  isLive: (key: number) => boolean
): DescendantsState {
  if (level >= TERRAIN_QUADTREE_MAX_LEVEL) return DescendantsState.None

  let found = false
  const childLevel = level + 1
  for (let di = 0; di < 2; di++) {
    for (let dj = 0; dj < 2; dj++) {
      const ci = i * 2 + di
      const cj = j * 2 + dj
      const childKey = (face << 20) | (childLevel << 16) | (ci << 8) | cj
      if (wanted.has(childKey)) {
        if (!isLive(childKey)) return DescendantsState.NotLive
        found = true
        continue
      }
      const deeper = descendantsState(face, childLevel, ci, cj, wanted, isLive)
      if (deeper === DescendantsState.NotLive) return DescendantsState.NotLive
      if (deeper === DescendantsState.AllLive) found = true
    }
  }

  return found ? DescendantsState.AllLive : DescendantsState.None
}

/**
 * x (показанный, но не желаемый узел) готов к освобождению, когда готова его
 * замена: либо ВСЕ желаемые листья внутри x построены (x дробится мельче),
 * либо построен желаемый предок x (x схлопывается крупнее). Отношение —
 * префикс адреса: тот же face, i>>Δ/j>>Δ совпадают на разнице уровней.
 *
 * Прежняя реализация в TerrainPatchGroup дважды сканировала весь `wanted` на
 * каждый освобождаемый узел (O(|live|×|wanted|), замер ревью 2026-08-17 —
 * 74 880 итераций/кадр со строковым ключом на итерацию). Здесь потомки
 * обходятся спуском по дереву (wanted — всегда полное разбиение граней,
 * рекурсия останавливается на его листьях), предок — подъёмом по битовым
 * сдвигам: стоимость O(листьев wanted внутри x) и O(level) соответственно,
 * аллокаций нет.
 */
export function coverageReady(
  x: TerrainNodeAddress,
  wanted: ReadonlyMap<number, TerrainNodeAddress>,
  isLive: (key: number) => boolean
): boolean {
  const below = descendantsState(x.face, x.level, x.i, x.j, wanted, isLive)
  if (below === DescendantsState.NotLive) return false
  if (below === DescendantsState.AllLive) return true

  for (let level = x.level - 1; level >= 0; level--) {
    const delta = x.level - level
    const key = (x.face << 20) | (level << 16) | ((x.i >> delta) << 8) | (x.j >> delta)
    if (wanted.has(key)) return isLive(key)
  }

  return false // связи не нашлось — не должно случаться, но пин безопаснее дыры
}
