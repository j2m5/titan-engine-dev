import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Sphere,
  Vector2,
  Vector3
} from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { cubeFaceDirection } from './cubeSphere'
import { wrapIndex, wrappedComponent, type DetailWrap } from './detailWrap'
import type { TerrainHeightField } from './TerrainHeightField'
import type { MidbandSample } from './midbandField'
// только тип: terrainPatchBuilder импортирует ядро сборки отсюда — обычный
// import замкнул бы модули в рантайме
import type { PatchBuildResult } from './terrainPatchBuilder'

/** Вершин в регулярной сетке патча segments×segments (без юбки). */
const gridVertexCount = (segments: number): number => (segments + 1) * (segments + 1)

/** Юбочных вершин — по одной на сегмент периметра, 4 стороны. */
const ringVertexCount = (segments: number): number => 4 * segments

/**
 * Полный вершинный счёт патча (регулярная сетка + юбочное кольцо) — общий
 * источник правды для аллокации буферов (пул, fresh-билдер) и тестов;
 * дублирование этой суммы разошлось бы независимо при правке сетки/юбки.
 */
export function terrainPatchVertexCount(segments: number): number {
  return gridVertexCount(segments) + ringVertexCount(segments)
}

/**
 * Индекс сеточной вершины на периметре патча по ходу обхода кольца k
 * (0..4·segments−1): CCW от угла (a=0,b=0) — низ слева направо, право
 * снизу вверх, верх справа налево, лево сверху вниз. Каждая точка периметра
 * встречается ровно один раз (углы не дублируются между сторонами).
 */
export function ringGridIndex(k: number, segments: number): number {
  let a: number
  let b: number

  if (k < segments) {
    a = k
    b = 0
  } else if (k < 2 * segments) {
    a = segments
    b = k - segments
  } else if (k < 3 * segments) {
    a = segments - (k - 2 * segments)
    b = segments
  } else {
    a = 0
    b = segments - (k - 3 * segments)
  }

  return b * (segments + 1) + a
}

/**
 * Общий индекс патча: у всех патчей одинаковая топология, поэтому один
 * BufferAttribute шарится по ссылке. Обмотка сетки CCW при взгляде снаружи —
 * базисы граней правые (u×v = n). За сеткой следует юбочная полоса —
 * 4·segments квадов между периметром сетки и юбочными вершинами (последние
 * (segments+1)² их не занимают в сетке — юбка добавляется билдером
 * геометрии после сеточного цикла). Юбка держит стык уровней LOD без щелей:
 * вертикальная стенка вниз по периметру патча перекрывает шов с соседом
 * другой глубины.
 */
export function buildPatchIndex(segments: number): BufferAttribute {
  const ringCount = ringVertexCount(segments)
  const gridCount = gridVertexCount(segments)
  const indices = new Uint16Array(segments * segments * 6 + ringCount * 6)
  let offset = 0

  for (let b = 0; b < segments; b++) {
    for (let a = 0; a < segments; a++) {
      const v00 = b * (segments + 1) + a
      const v10 = v00 + 1
      const v01 = v00 + (segments + 1)
      const v11 = v01 + 1

      indices[offset++] = v00
      indices[offset++] = v10
      indices[offset++] = v11
      indices[offset++] = v00
      indices[offset++] = v11
      indices[offset++] = v01
    }
  }

  for (let k = 0; k < ringCount; k++) {
    const kNext = (k + 1) % ringCount
    const edgeA = ringGridIndex(k, segments)
    const edgeB = ringGridIndex(kNext, segments)
    const skirtA = gridCount + k
    const skirtB = gridCount + kNext

    // обмотка наружу: стенка юбки — зеркало паттерна сеточного квада (там
    // «вверх» по b — обычная соседняя строка сетки, здесь «вниз» — юбка,
    // поэтому диагональный сплит зеркалится, иначе нормаль стенки смотрит
    // внутрь патча, а не наружу по касательной
    indices[offset++] = edgeA
    indices[offset++] = skirtB
    indices[offset++] = edgeB
    indices[offset++] = edgeA
    indices[offset++] = skirtA
    indices[offset++] = skirtB
  }

  return new BufferAttribute(indices, 1)
}

/**
 * Скретч направлений сеточных вершин: НЕ атрибут — направление живёт в
 * геометрии как position + patchCenter, а здесь нужно только юбке (радиальный
 * сдвиг кромки). Один буфер на модуль, а не аллокация на сборку: временный
 * массив на каждую постройку был бы мусором в горячем пути. Мешер
 * синхронный и не реентерабельный — перекрытия сборок не бывает.
 */
let gridDirsScratch = new Float32Array(0)

function gridDirs(gridCount: number): Float32Array {
  if (gridDirsScratch.length < gridCount * 3) gridDirsScratch = new Float32Array(gridCount * 3)

  return gridDirsScratch
}

/** Скретч родительских RTC-позиций сеточных вершин (f64 — сдвиг считается до квантования); как gridDirs. */
let parentPosScratch = new Float64Array(0)

function parentPositions(gridCount: number): Float64Array {
  if (parentPosScratch.length < gridCount * 3) parentPosScratch = new Float64Array(gridCount * 3)

  return parentPosScratch
}

/** Родительская форма вершин (геоморф): цель, к которой вершинник ведёт патч перед слиянием. */
export interface PatchMorphArrays {
  /** Родительская позиция минус своя, RTC-юниты патча, vec3 на вершину. */
  deltas: Float32Array
  /** Родительский midTilt, vec2. */
  midTilts: Float32Array
  /** Родительский midShade, vec2. */
  midShades: Float32Array
}

/** Типизированные буферы вершинных атрибутов патча — вход/выход ядра мешера, без BufferGeometry (нужно воркеру). */
export interface PatchArrays {
  positions: Float32Array
  /** null — раскладка воды: полосы у потребителя нет, ядро её не пишет. */
  heights: Float32Array | null
  midTilts: Float32Array | null
  midShades: Float32Array | null
  /** null — у потребителя нет морф-атрибутов, ядро их не пишет. */
  morph: PatchMorphArrays | null
}

/** Ограничивающая сфера патча в RTC-координатах (относительно center) — как geometry.boundingSphere. */
export interface PatchBounds {
  cx: number
  cy: number
  cz: number
  radius: number
}

/**
 * Аллоцирует массивы под патч segments×segments нужного размера (см.
 * terrainPatchVertexCount) — вход buildTerrainPatchArrays для fresh-сборки
 * (main-поток эталон, воркер) без BufferGeometry. withBand = false — раскладка
 * воды: только positions (геоморф без полосы невозможен).
 */
export function allocatePatchArrays(segments: number, withMorph = false, withBand = true): PatchArrays {
  if (withMorph && !withBand) throw new Error('геоморф без атрибутов полосы: такой раскладки нет')
  const n = terrainPatchVertexCount(segments)
  return {
    positions: new Float32Array(n * 3),
    heights: withBand ? new Float32Array(n) : null,
    midTilts: withBand ? new Float32Array(n * 2) : null,
    midShades: withBand ? new Float32Array(n * 2) : null,
    morph: withMorph
      ? { deltas: new Float32Array(n * 3), midTilts: new Float32Array(n * 2), midShades: new Float32Array(n * 2) }
      : null
  }
}

/** Массивы под задание: morph === null — пул воды (только positions), иначе рельеф (полоса + морф). */
export function allocateJobPatchArrays(segments: number, morph: boolean | null): PatchArrays {
  return morph === null ? allocatePatchArrays(segments, false, false) : allocatePatchArrays(segments, true)
}

/**
 * Ставит geometry.boundingSphere из уже посчитанного ядром PatchBounds — без
 * обхода вершин (воркер вернёт сферу вместе с массивами, обходить их на
 * главном потоке второй раз не нужно).
 */
export function applyPatchBounds(geometry: BufferGeometry, bounds: PatchBounds): void {
  if (geometry.boundingSphere === null) geometry.boundingSphere = new Sphere()
  geometry.boundingSphere.center.set(bounds.cx, bounds.cy, bounds.cz)
  geometry.boundingSphere.radius = bounds.radius
}

/**
 * Ядро сборки RTC-патча (face, i, j) глубины depth: пишет вершинные атрибуты
 * в переданные массивы (уже нужного размера — вызывающий считает
 * vertexCount) и возвращает RTC-центр и ограничивающую сферу. Чистая функция
 * над типизированными массивами — без BufferGeometry, годна для Web Worker.
 * Общее для fresh-варианта
 * (аллоцирует массивы сам) и строителей (terrainPatchBuilder: свежие массивы
 * на задание, во владение потребителю). Инстансный атрибут patchCenter
 * пишет вызывающий из возвращённого center.
 *
 * Позиции хранятся ОТНОСИТЕЛЬНО центра патча (центр — в position меша),
 * больших чисел во float32 нет, катастрофическое сокращение происходит в f64
 * на CPU при сборке modelViewMatrix. Высота — те же канонические
 * dirToUv/sampleMeters, что использует surfaceRadiusUnits (мешер и коллизия
 * читают одни данные одной формулой; мешер зовёт dirToUv один раз на
 * вершину, не через surfaceRadiusUnits повторно — см. перф-заметку в цикле
 * ниже). Радиальное направление вершины — не атрибут: вершинник считает его
 * как normalize(position + patchCenter), развёртку uv фрагментник считает
 * попиксельно из этого направления (см. terrainUvFunctions). Юбка
 * (skirtDepthUnits > 0) добавляет по периметру патча вертикальную стенку —
 * копию кромочной вершины с радиусом, уменьшенным на skirtDepthUnits:
 * скрывает щель на стыке с соседним патчем другой глубины квадродерева без
 * необходимости совпадения тесселяций.
 *
 * detailOrigin/detailOrigin2 — домен детальных слоёв (40 м / 7 м) смещением
 * на патч: center − k·W (k = wrapIndex от центра, double до квантования,
 * см. detailWrap.ts). Вершинник собирает домен как position + detailOrigin —
 * |detailOrigin| ≤ W/2 по компоненте, поэтому float32 его не портит, а
 * сложение с RTC-позицией теряет доли миллиметра на глубоких патчах.
 *
 * height — метры над референсом ТОЛЬКО по карте (без полосы) — фаза террас
 * средней полосы в шейдере; позиция вершины при этом несёт карту + полосу,
 * взвешенную по шагу вершин уровня (октаву короче шага сетка не несёт).
 * midTilt — наклон полосы (tan) в базисе восток/север вершины.
 * midShade — геометрия полосы для затенения: x — высота полосы в долях её
 * максимальной амплитуды (−1..1), y — доля октав уровня, взвешенная огибающей
 * (гейт пиксельного fbm: где полоса ЕСТЬ, fbm не дублирует её рельеф; у уреза
 * воды и на равнине огибающая мала — fbm остаётся).
 *
 * Родительская форма (при arrays.morph !== null): morph = true — форма
 * уровня depth − 1 в каждой вершине. Чётная вершина (a, b) совпадает с
 * вершиной родителя — карта та же, полоса взвешена шагом родителя; нечётная —
 * середина ребра родителя, центр квада — по диагонали индекса v00→v11 (так
 * режет квад buildPatchIndex). Юбка копирует цель кромки. morph = false —
 * сдвиг нулевой, родительские атрибуты = свои. Сфера охватывает обе формы.
 */
export function buildTerrainPatchArrays(
  field: TerrainHeightField,
  face: number,
  i: number,
  j: number,
  depth: number,
  segments: number,
  skirtDepthUnits: number,
  wrap: DetailWrap,
  arrays: PatchArrays,
  morph: boolean
): {
  center: Vector3
  bounds: PatchBounds
  detailOrigin: [number, number, number]
  detailOrigin2: [number, number, number]
} {
  const { positions, heights, midTilts, midShades } = arrays
  const morphArrays = arrays.morph
  // полоса пишется только у раскладки рельефа; у воды (null) ядро её не трогает
  const hasBand = heights !== null && midTilts !== null && midShades !== null
  if (morphArrays !== null && !hasBand) throw new Error('геоморф без атрибутов полосы: такой раскладки нет')
  const withParent = morph && morphArrays !== null
  // сетка ребёнка вложена в родительскую только при чётном segments
  if (withParent && segments % 2 !== 0) throw new Error(`геоморф требует чётного segments, получено ${segments}`)
  const patches = 1 << depth
  const span = 2 / patches
  const s0 = -1 + i * span
  const t0 = -1 + j * span

  const dir = new Vector3()
  const uv = new Vector2()
  // скретч полосы: один на всю сборку патча, аллокаций в цикле нет
  const bandScratch: MidbandSample = { heightMeters: 0, tiltE: 0, tiltN: 0, octaveWeightSum: 0, envelope: 0 }
  const parentScratch: MidbandSample = { heightMeters: 0, tiltE: 0, tiltN: 0, octaveWeightSum: 0, envelope: 0 }
  // шаг вершин этого патча — по нему взвешены октавы полосы
  const stepMeters = field.vertexStepMeters(depth, segments)
  const parentStep = withParent ? field.vertexStepMeters(depth - 1, segments) : -1
  // нормировка высоты полосы к её потолку: midShade.x безразмерен в шейдере
  const maxAmplitude = field.midbandMaxAmplitudeMeters

  const centerDir = cubeFaceDirection(face, s0 + span / 2, t0 + span / 2, new Vector3())
  const center = centerDir.clone().multiplyScalar(field.surfaceRadiusUnits(centerDir))

  // домен детали — смещение на патч, вершинник прибавит его к position
  const detailOrigin: [number, number, number] = [
    wrappedComponent(center.x, wrapIndex(center.x, wrap.w1), wrap.w1),
    wrappedComponent(center.y, wrapIndex(center.y, wrap.w1), wrap.w1),
    wrappedComponent(center.z, wrapIndex(center.z, wrap.w1), wrap.w1)
  ]
  const detailOrigin2: [number, number, number] = [
    wrappedComponent(center.x, wrapIndex(center.x, wrap.w2), wrap.w2),
    wrappedComponent(center.y, wrapIndex(center.y, wrap.w2), wrap.w2),
    wrappedComponent(center.z, wrapIndex(center.z, wrap.w2), wrap.w2)
  ]

  const gridCount = gridVertexCount(segments)
  const ringCount = ringVertexCount(segments)

  const dirs = gridDirs(gridCount)
  const parentPos = withParent ? parentPositions(gridCount) : null

  let k = 0
  for (let b = 0; b <= segments; b++) {
    for (let a = 0; a <= segments; a++) {
      cubeFaceDirection(face, s0 + (span * a) / segments, t0 + (span * b) / segments, dir)

      // dirToUv один раз на вершину: surfaceRadiusUnits(dir) внутри тоже звал бы
      // его повторно (heightMeters → dirToUv) — 1.62М лишних atan2+acos на сборке
      field.dirToUv(dir, uv)
      const mapMeters = field.sampleMeters(uv.x, uv.y)
      // родитель — только в чётных вершинах (совпадают с его сеткой), нечётные
      // берут середины рёбер во втором проходе: цена полосы почти не растёт
      const even = parentPos !== null && a % 2 === 0 && b % 2 === 0
      const band = even
        ? field.midbandSample(dir, uv.x, uv.y, mapMeters, bandScratch, stepMeters, true, parentStep, parentScratch)
        : field.midbandSample(dir, uv.x, uv.y, mapMeters, bandScratch, stepMeters)
      const heightMeters = mapMeters + band.heightMeters
      if (hasBand) {
        // Фаза террас — от высоты КАРТЫ: бугры полосы (до ~84 м при шаге 150 м)
        // рисовали бы замкнутые горизонтали вокруг каждого бугра
        heights[k] = mapMeters
        midTilts[k * 2] = band.tiltE
        midTilts[k * 2 + 1] = band.tiltN
        midShades[k * 2] = maxAmplitude > 0 ? band.heightMeters / maxAmplitude : 0
        // доля октав, взвешенная огибающей: у уреза воды и на равнине (flat 0.15)
        // пиксельный fbm остаётся, на склонах полоса вытесняет его
        midShades[k * 2 + 1] = band.octaveWeightSum * Math.min(1, band.envelope)
      }
      const r = toThreeJSUnits(field.radiusKm + heightMeters / 1000)
      positions[k * 3] = dir.x * r - center.x
      positions[k * 3 + 1] = dir.y * r - center.y
      positions[k * 3 + 2] = dir.z * r - center.z

      if (even && parentPos !== null && morphArrays !== null) {
        // та же формула, что у своей позиции и у сборки родителя — f64 до сдвига
        const rP = toThreeJSUnits(field.radiusKm + (mapMeters + parentScratch.heightMeters) / 1000)
        parentPos[k * 3] = dir.x * rP - center.x
        parentPos[k * 3 + 1] = dir.y * rP - center.y
        parentPos[k * 3 + 2] = dir.z * rP - center.z
        morphArrays.midTilts[k * 2] = parentScratch.tiltE
        morphArrays.midTilts[k * 2 + 1] = parentScratch.tiltN
        morphArrays.midShades[k * 2] = maxAmplitude > 0 ? parentScratch.heightMeters / maxAmplitude : 0
        morphArrays.midShades[k * 2 + 1] = parentScratch.octaveWeightSum * Math.min(1, parentScratch.envelope)
      }

      dirs[k * 3] = dir.x
      dirs[k * 3 + 1] = dir.y
      dirs[k * 3 + 2] = dir.z

      k++
    }
  }

  if (parentPos !== null && morphArrays !== null) {
    const { deltas, midTilts: tiltsP, midShades: shadesP } = morphArrays
    const row = segments + 1
    k = 0
    for (let b = 0; b <= segments; b++) {
      for (let a = 0; a <= segments; a++) {
        if (a % 2 === 0 && b % 2 === 0) {
          deltas[k * 3] = parentPos[k * 3] - positions[k * 3]
          deltas[k * 3 + 1] = parentPos[k * 3 + 1] - positions[k * 3 + 1]
          deltas[k * 3 + 2] = parentPos[k * 3 + 2] - positions[k * 3 + 2]
        } else {
          // соседи на сетке родителя: ребро по a, ребро по b или диагональ v00→v11
          const n1 = k - (b % 2) * row - (a % 2)
          const n2 = k + (b % 2) * row + (a % 2)
          deltas[k * 3] = (parentPos[n1 * 3] + parentPos[n2 * 3]) / 2 - positions[k * 3]
          deltas[k * 3 + 1] = (parentPos[n1 * 3 + 1] + parentPos[n2 * 3 + 1]) / 2 - positions[k * 3 + 1]
          deltas[k * 3 + 2] = (parentPos[n1 * 3 + 2] + parentPos[n2 * 3 + 2]) / 2 - positions[k * 3 + 2]
          tiltsP[k * 2] = (tiltsP[n1 * 2] + tiltsP[n2 * 2]) / 2
          tiltsP[k * 2 + 1] = (tiltsP[n1 * 2 + 1] + tiltsP[n2 * 2 + 1]) / 2
          shadesP[k * 2] = (shadesP[n1 * 2] + shadesP[n2 * 2]) / 2
          shadesP[k * 2 + 1] = (shadesP[n1 * 2 + 1] + shadesP[n2 * 2 + 1]) / 2
        }
        k++
      }
    }
  }

  // юбка: копия кромочной вершины, радиус кромки минус skirtDepthUnits.
  // Вычитание направления (float32, из dirs) из УЖЕ квантованной позиции
  // кромки, а не пересборка dir·(r−skirtDepthUnits) заново, — общая ошибка
  // округления кромочной позиции входит в обе вершины одинаково и почти
  // полностью сокращается в разности длин edge/skirt (см. тест «юбочная
  // вершина ниже своей кромочной ровно на skirtDepthUnits»); независимый
  // пересчёт этого сокращения не даёт.
  for (let ring = 0; ring < ringCount; ring++) {
    const edgeIndex = ringGridIndex(ring, segments)
    const skirtIndex = gridCount + ring

    const nx = dirs[edgeIndex * 3]
    const ny = dirs[edgeIndex * 3 + 1]
    const nz = dirs[edgeIndex * 3 + 2]

    positions[skirtIndex * 3] = positions[edgeIndex * 3] - nx * skirtDepthUnits
    positions[skirtIndex * 3 + 1] = positions[edgeIndex * 3 + 1] - ny * skirtDepthUnits
    positions[skirtIndex * 3 + 2] = positions[edgeIndex * 3 + 2] - nz * skirtDepthUnits

    if (hasBand) {
      // юбка несёт высоту кромки — радиальный сдвиг юбки не рельеф
      heights[skirtIndex] = heights[edgeIndex]

      // юбка несёт наклон полосы своей кромочной вершины
      midTilts[skirtIndex * 2] = midTilts[edgeIndex * 2]
      midTilts[skirtIndex * 2 + 1] = midTilts[edgeIndex * 2 + 1]

      // юбка несёт геометрию полосы своей кромочной вершины
      midShades[skirtIndex * 2] = midShades[edgeIndex * 2]
      midShades[skirtIndex * 2 + 1] = midShades[edgeIndex * 2 + 1]
    }

    // стенка сдвигается вместе с кромкой: иначе в морфе щель между ними
    if (withParent && morphArrays !== null) {
      const { deltas, midTilts: tiltsP, midShades: shadesP } = morphArrays
      deltas[skirtIndex * 3] = deltas[edgeIndex * 3]
      deltas[skirtIndex * 3 + 1] = deltas[edgeIndex * 3 + 1]
      deltas[skirtIndex * 3 + 2] = deltas[edgeIndex * 3 + 2]
      tiltsP[skirtIndex * 2] = tiltsP[edgeIndex * 2]
      tiltsP[skirtIndex * 2 + 1] = tiltsP[edgeIndex * 2 + 1]
      shadesP[skirtIndex * 2] = shadesP[edgeIndex * 2]
      shadesP[skirtIndex * 2 + 1] = shadesP[edgeIndex * 2 + 1]
    }
  }

  // без родителя форма одна: сдвиг ноль, родительские атрибуты — свои
  if (!withParent && morphArrays !== null && hasBand) {
    morphArrays.deltas.fill(0)
    morphArrays.midTilts.set(midTilts)
    morphArrays.midShades.set(midShades)
  }

  // сфера тем же алгоритмом, что BufferGeometry.computeBoundingSphere без
  // morph-атрибутов: центр — центр bbox по всем вершинам, радиус — max
  // расстояние до него (three считает Math.sqrt(maxRadiusSq)). С морф-массивами
  // — по объединению своей и родительской формы (position + morphDelta)
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const total = gridCount + ringCount
  const morphDeltas = morphArrays === null ? null : morphArrays.deltas
  for (let k = 0; k < total; k++) {
    const x = positions[k * 3], y = positions[k * 3 + 1], z = positions[k * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    if (morphDeltas !== null) {
      const px = x + morphDeltas[k * 3], py = y + morphDeltas[k * 3 + 1], pz = z + morphDeltas[k * 3 + 2]
      if (px < minX) minX = px; if (px > maxX) maxX = px
      if (py < minY) minY = py; if (py > maxY) maxY = py
      if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz
    }
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2
  let maxRadiusSq = 0
  for (let k = 0; k < total; k++) {
    const dx = positions[k * 3] - cx, dy = positions[k * 3 + 1] - cy, dz = positions[k * 3 + 2] - cz
    maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dy * dy + dz * dz)
    if (morphDeltas !== null) {
      const ex = positions[k * 3] + morphDeltas[k * 3] - cx
      const ey = positions[k * 3 + 1] + morphDeltas[k * 3 + 1] - cy
      const ez = positions[k * 3 + 2] + morphDeltas[k * 3 + 2] - cz
      maxRadiusSq = Math.max(maxRadiusSq, ex * ex + ey * ey + ez * ez)
    }
  }

  return { center, bounds: { cx, cy, cz, radius: Math.sqrt(maxRadiusSq) }, detailOrigin, detailOrigin2 }
}

/**
 * Fresh-вариант: аллоцирует новые типизированные массивы и геометрию —
 * эталон паритета для прихода строителя (applyPatchResult) и его тестов;
 * продакшн-вызовов нет.
 */
export function buildTerrainPatchGeometry(
  field: TerrainHeightField,
  face: number,
  i: number,
  j: number,
  depth: number,
  segments: number,
  index: BufferAttribute,
  skirtDepthUnits: number,
  wrap: DetailWrap,
  morph = false
): { geometry: BufferGeometry; center: Vector3 } {
  // эталон — раскладка рельефа: полоса выделена всегда (allocatePatchArrays с withBand по умолчанию)
  const arrays = allocatePatchArrays(segments, morph)
  const { positions } = arrays
  const heights = arrays.heights!
  const midTilts = arrays.midTilts!
  const midShades = arrays.midShades!

  const { center, bounds, detailOrigin, detailOrigin2 } = buildTerrainPatchArrays(
    field, face, i, j, depth, segments, skirtDepthUnits, wrap, arrays, morph
  )

  // раскладка бит-в-бит как у слота пула (см. TerrainPatchPool.createHandle):
  // InstancedBufferGeometry с одним инстансом и центром патча в инстансном атрибуте
  const geometry = new InstancedBufferGeometry()
  geometry.instanceCount = 1
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('height', new BufferAttribute(heights, 1))
  geometry.setAttribute('midTilt', new BufferAttribute(midTilts, 2))
  geometry.setAttribute('midShade', new BufferAttribute(midShades, 2))
  if (arrays.morph !== null) {
    geometry.setAttribute('morphDelta', new BufferAttribute(arrays.morph.deltas, 3))
    geometry.setAttribute('midTiltParent', new BufferAttribute(arrays.morph.midTilts, 2))
    geometry.setAttribute('midShadeParent', new BufferAttribute(arrays.morph.midShades, 2))
  }
  geometry.setAttribute('patchCenter', new InstancedBufferAttribute(new Float32Array([center.x, center.y, center.z]), 3))
  geometry.setAttribute('detailOrigin', new InstancedBufferAttribute(new Float32Array(detailOrigin), 3))
  geometry.setAttribute('detailOrigin2', new InstancedBufferAttribute(new Float32Array(detailOrigin2), 3))
  geometry.setIndex(index)
  applyPatchBounds(geometry, bounds)

  return { geometry, center }
}

/** Инстансный атрибут слота (один элемент на патч) — запись на месте. */
function writeInstanceAttribute(geometry: InstancedBufferGeometry, name: string, values: readonly number[]): void {
  const attribute = geometry.getAttribute(name) as BufferAttribute
  ;(attribute.array as Float32Array).set(values)
  attribute.needsUpdate = true
}


/** Вершинный атрибут слота берёт массив результата во владение (без копии) и ставит заливку. */
function takeVertexArray(geometry: InstancedBufferGeometry, name: string, source: Float32Array): void {
  const attribute = geometry.getAttribute(name) as BufferAttribute
  attribute.array = source
  attribute.needsUpdate = true
}

/**
 * Приход результата строителя в слот: вершинные массивы переходят к слоту без
 * копии (контракт TerrainPatchBuilder), инстансные — пишутся на месте; до
 * заливки position патч рисуется без фрустум-каллинга (см. TerrainPatchPool).
 */
export function applyPatchResult(handle: { mesh: Mesh; geometry: InstancedBufferGeometry }, result: PatchBuildResult): void {
  const { geometry, mesh } = handle
  const { arrays } = result
  const terrainSlot = geometry.getAttribute('height') !== undefined
  const terrainResult = arrays.heights !== null
  if (terrainSlot !== terrainResult) {
    throw new Error(`раскладка результата (${terrainResult ? 'рельеф' : 'вода'}) не совпадает со слотом (${terrainSlot ? 'рельеф' : 'вода'})`)
  }

  takeVertexArray(geometry, 'position', arrays.positions)
  if (terrainSlot) {
    takeVertexArray(geometry, 'height', arrays.heights!)
    takeVertexArray(geometry, 'midTilt', arrays.midTilts!)
    takeVertexArray(geometry, 'midShade', arrays.midShades!)
    if (geometry.getAttribute('morphDelta') !== undefined) {
      if (arrays.morph !== null) {
        takeVertexArray(geometry, 'morphDelta', arrays.morph.deltas)
        takeVertexArray(geometry, 'midTiltParent', arrays.morph.midTilts)
        takeVertexArray(geometry, 'midShadeParent', arrays.morph.midShades)
      } else {
        // результат без морфа в морф-слот: дельты прошлого владельца не оставляем, родитель = своя форма
        takeVertexArray(geometry, 'morphDelta', new Float32Array(arrays.positions.length))
        takeVertexArray(geometry, 'midTiltParent', arrays.midTilts!.slice())
        takeVertexArray(geometry, 'midShadeParent', arrays.midShades!.slice())
      }
    }
  }

  writeInstanceAttribute(geometry, 'patchCenter', result.center)
  writeInstanceAttribute(geometry, 'detailOrigin', result.detailOrigin)
  if (geometry.getAttribute('detailOrigin2') !== undefined) writeInstanceAttribute(geometry, 'detailOrigin2', result.detailOrigin2)

  applyPatchBounds(geometry, result.bounds)
  mesh.position.fromArray(result.center)
  // патч вне кадра three не заливает: первый кадр — без каллинга, заливка position его вернёт
  mesh.frustumCulled = false
}
