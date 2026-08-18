import { Frustum, Sphere, Vector3 } from 'three'
import { SpaceScale } from '@/core/constants'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { CUBE_FACES, cubeFaceDirection } from './cubeSphere'
import type { TerrainHeightField } from './TerrainHeightField'

/** Адрес узла квадродерева грани кубосферы: (face, level, i, j). level 0 — целая грань, не адресуется наружу. */
export type TerrainNodeAddress = { face: number; level: number; i: number; j: number }

export const terrainNodeKey = (a: TerrainNodeAddress): string => `${a.face}/${a.level}/${a.i}/${a.j}`

/** Ниже этого уровня узел спускается безусловно — минимальный набор всегда 6·4^MIN_LEVEL листьев. */
export const TERRAIN_QUADTREE_MIN_LEVEL = 1

/** Глубже этого уровня спуск не идёт даже при недостижимом SSE-пороге. */
export const TERRAIN_QUADTREE_MAX_LEVEL = 6

/** Клирофф дистанции у камеры на/под поверхностью — иначе sse делится на почти-ноль и уходит в бесконечность. */
const MIN_DISTANCE_METERS = 100

/**
 * Потолок глубины подводных патчей суши (Task 5, water-foundation): узел на
 * этом уровне или глубже, чей оценённый максимум высоты уверенно ниже уровня
 * воды, дальше не делится — цель: океанские патчи не глубже ~L4 (не
 * TERRAIN_QUADTREE_MAX_LEVEL=6). Ниже этого уровня потолок не действует —
 * береговые/мелководные узлы обязаны домешаться честно на общих основаниях
 * (SSE), запрет применяется только к уже достаточно мелким узлам, где
 * визуальная разница под непрозрачной водой всё равно не видна.
 */
export const TERRAIN_QUADTREE_WATER_CEILING_LEVEL = 4

/**
 * Множитель ε-пирамиды (`geometricErrorMeters`, p99 размаха высот в окне
 * уровня) в оценке максимума высоты узла для потолка воды: центр узла ±
 * запас на локальный размах — статистическая (p99, не жёсткая) оценка,
 * удвоенная как двусторонний запас на редкий выброс. Та же эпистемология,
 * что и у самого SSE-отбора (ε-пирамида везде здесь p99, не honest max) —
 * не строже остального дерева.
 */
const WATER_CEILING_ERROR_FACTOR = 2

/**
 * Фиксированный запас поверх статистической оценки, метры — берег обязан
 * домешаться честно даже при небольшой недооценке максимума узла между
 * центром выборки и его истинным пиком.
 */
const WATER_CEILING_MARGIN_METERS = 50

export interface SelectParams {
  field: TerrainHeightField
  cameraLocal: Vector3 // юниты, теле-фиксированный фрейм
  frustumLocal: Frustum | null // null = без фрустум-гейта (тесты)
  screenHeight: number // px
  fovYRadians: number
  splitPixels: number // ручка terrain.sseSplitPixels
  mergeFactor: number // ручка terrain.sseMergeFactor
  currentlySplit: ReadonlySet<string> // ключи узлов, разбитых в прошлом кадре
  /**
   * Уровень воды тела, метры (Task 5, water-foundation) — ручка актора, не
   * поля (см. докблок `TerrainHeightField`/`CameraCollision.Collider`).
   * Отсутствие — потолок подводных патчей не действует, отбор бит-в-бит
   * прежний.
   */
  waterLevelMeters?: number
}

// Скретчи модуля: функция зовётся каждый кадр, аллокаций на вызов быть не должно.
// Recursion синхронна и глубину узла не переиспользует после ветвления — общие
// скретчи безопасны между уровнями.
const centerDirScratch = new Vector3()
const sphereCenterScratch = new Vector3()
const sphereScratch = new Sphere()

function visitNode(
  face: number,
  level: number,
  i: number,
  j: number,
  params: SelectParams,
  leaves: TerrainNodeAddress[],
  split: Set<string>
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
  sphereCenterScratch.copy(centerDirScratch).multiplyScalar(field.surfaceRadiusUnits(centerDirScratch))

  // половина диагонали дуги патча (юниты) + запас на амплитуду рельефа
  const patchHalfDiagonal = ((toThreeJSUnits(field.radiusKm) * (Math.PI / 2)) / 2 ** level) * (Math.SQRT2 / 2)
  const heightPad = toThreeJSUnits(Math.max(Math.abs(field.minMeters), Math.abs(field.maxMeters)) / 1000)
  const sphereRadius = patchHalfDiagonal + heightPad

  const minDistanceUnits = toThreeJSUnits(MIN_DISTANCE_METERS / 1000)
  const distance = Math.max(params.cameraLocal.distanceTo(sphereCenterScratch) - sphereRadius, minDistanceUnits)
  const distanceMeters = (distance / SpaceScale) * 1000

  const sse =
    (field.geometricErrorMeters(level) * params.screenHeight) /
    (2 * Math.tan(params.fovYRadians / 2) * distanceMeters)

  // формат совпадает с terrainNodeKey — вызывается без промежуточного
  // TerrainNodeAddress, чтобы не аллоцировать объект на каждый посещённый узел
  const key = `${face}/${level}/${i}/${j}`
  const threshold = params.currentlySplit.has(key) ? params.splitPixels * params.mergeFactor : params.splitPixels

  let visible = true
  if (params.frustumLocal) {
    sphereScratch.center.copy(sphereCenterScratch)
    sphereScratch.radius = sphereRadius
    visible = params.frustumLocal.intersectsSphere(sphereScratch)
  }

  // Потолок подводных патчей суши (Task 5): считается только когда есть ручка
  // И узел уже достаточно мелкий (level >= WATER_CEILING_LEVEL) — без ручки
  // ни одного лишнего heightMeters-вызова на кадр, отбор бит-в-бит прежний.
  // Оценка максимума узла — центр + запас ε-пирамиды текущего уровня (см.
  // докблок константы); дороже sse не становится (тот же field.geometricErrorMeters,
  // уже посчитанный выше, плюс один билинейный сэмпл высоты).
  let belowWaterCeiling = false
  if (params.waterLevelMeters !== undefined && level >= TERRAIN_QUADTREE_WATER_CEILING_LEVEL) {
    const nodeMaxHeightEstimate =
      field.heightMeters(centerDirScratch) + WATER_CEILING_ERROR_FACTOR * field.geometricErrorMeters(level)
    belowWaterCeiling = nodeMaxHeightEstimate < params.waterLevelMeters - WATER_CEILING_MARGIN_METERS
  }

  const shouldSplit = level < TERRAIN_QUADTREE_MAX_LEVEL && sse > threshold && visible && !belowWaterCeiling

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
  split: Set<string>
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
export function selectTerrainNodes(params: SelectParams): { leaves: TerrainNodeAddress[]; split: Set<string> } {
  const leaves: TerrainNodeAddress[] = []
  const split = new Set<string>()

  for (let face = 0; face < CUBE_FACES; face++) {
    visitNode(face, 0, 0, 0, params, leaves, split)
  }

  return { leaves, split }
}
