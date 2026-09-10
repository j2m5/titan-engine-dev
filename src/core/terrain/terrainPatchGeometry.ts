import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Vector2,
  Vector3
} from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { cubeFaceDirection } from './cubeSphere'
import { wrapIndex, wrappedComponent, type DetailWrap } from './detailWrap'
import type { TerrainHeightField } from './TerrainHeightField'
import type { MidbandSample } from './midbandField'

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
function ringGridIndex(k: number, segments: number): number {
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
 * сдвиг кромки). Один буфер на модуль, а не аллокация на сборку: into-вариант
 * существует ровно ради отсутствия аллокаций в split/merge. Мешер
 * синхронный и не реентерабельный — перекрытия сборок не бывает.
 */
let gridDirsScratch = new Float32Array(0)

function gridDirs(gridCount: number): Float32Array {
  if (gridDirsScratch.length < gridCount * 3) gridDirsScratch = new Float32Array(gridCount * 3)

  return gridDirsScratch
}

/**
 * Ядро сборки RTC-патча (face, i, j) глубины depth: пишет вершинные атрибуты
 * в переданные массивы (уже нужного размера — вызывающий считает
 * vertexCount) и возвращает RTC-центр. Общее для fresh-варианта (аллоцирует
 * массивы сам) и into-варианта пула (переиспользует буферы существующей
 * геометрии без аллокаций). Инстансный атрибут patchCenter пишет вызывающий
 * из возвращённого center.
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
 * detailPos/detailPos2 — тело-локальная позиция вершины (dir·r, ДО вычитания
 * center) минус k·W домена детали (см. detailWrap.ts), k общий на весь патч
 * и берётся от центра патча — иначе обёртка рвала бы треугольники внутри
 * патча. Два набора — под два слоя детали (40 м / 7 м), каждый со своим W.
 *
 * height — метры над референсом ТОЛЬКО по карте (без полосы) — фаза террас
 * средней полосы в шейдере; позиция вершины при этом несёт карту + полосу.
 * midTilt — наклон полосы (tan) в базисе восток/север вершины.
 */
function writeTerrainPatchAttributes(
  field: TerrainHeightField,
  face: number,
  i: number,
  j: number,
  depth: number,
  segments: number,
  skirtDepthUnits: number,
  positions: Float32Array,
  detailPos: Float32Array,
  detailPos2: Float32Array,
  heights: Float32Array,
  midTilts: Float32Array,
  wrap: DetailWrap
): Vector3 {
  const patches = 1 << depth
  const span = 2 / patches
  const s0 = -1 + i * span
  const t0 = -1 + j * span

  const dir = new Vector3()
  const uv = new Vector2()
  // скретч полосы: один на всю сборку патча, аллокаций в цикле нет
  const bandScratch: MidbandSample = { heightMeters: 0, tiltE: 0, tiltN: 0 }

  const centerDir = cubeFaceDirection(face, s0 + span / 2, t0 + span / 2, new Vector3())
  const center = centerDir.clone().multiplyScalar(field.surfaceRadiusUnits(centerDir))

  const wrapK1: readonly [number, number, number] = [
    wrapIndex(center.x, wrap.w1),
    wrapIndex(center.y, wrap.w1),
    wrapIndex(center.z, wrap.w1)
  ]
  const wrapK2: readonly [number, number, number] = [
    wrapIndex(center.x, wrap.w2),
    wrapIndex(center.y, wrap.w2),
    wrapIndex(center.z, wrap.w2)
  ]

  const gridCount = gridVertexCount(segments)
  const ringCount = ringVertexCount(segments)

  const dirs = gridDirs(gridCount)

  let k = 0
  for (let b = 0; b <= segments; b++) {
    for (let a = 0; a <= segments; a++) {
      cubeFaceDirection(face, s0 + (span * a) / segments, t0 + (span * b) / segments, dir)

      // dirToUv один раз на вершину: surfaceRadiusUnits(dir) внутри тоже звал бы
      // его повторно (heightMeters → dirToUv) — 1.62М лишних atan2+acos на сборке
      field.dirToUv(dir, uv)
      const band = field.midbandSample(dir, uv.x, uv.y, bandScratch)
      const mapMeters = field.sampleMeters(uv.x, uv.y)
      const heightMeters = mapMeters + band.heightMeters
      // Фаза террас — от высоты КАРТЫ: бугры полосы (до ~84 м при шаге 150 м)
      // рисовали бы замкнутые горизонтали вокруг каждого бугра
      heights[k] = mapMeters
      midTilts[k * 2] = band.tiltE
      midTilts[k * 2 + 1] = band.tiltN
      const r = toThreeJSUnits(field.radiusKm + heightMeters / 1000)
      positions[k * 3] = dir.x * r - center.x
      positions[k * 3 + 1] = dir.y * r - center.y
      positions[k * 3 + 2] = dir.z * r - center.z

      // домен детали: точная позиция минус k·W (double → float32), см. detailWrap.ts
      detailPos[k * 3] = wrappedComponent(dir.x * r, wrapK1[0], wrap.w1)
      detailPos[k * 3 + 1] = wrappedComponent(dir.y * r, wrapK1[1], wrap.w1)
      detailPos[k * 3 + 2] = wrappedComponent(dir.z * r, wrapK1[2], wrap.w1)
      detailPos2[k * 3] = wrappedComponent(dir.x * r, wrapK2[0], wrap.w2)
      detailPos2[k * 3 + 1] = wrappedComponent(dir.y * r, wrapK2[1], wrap.w2)
      detailPos2[k * 3 + 2] = wrappedComponent(dir.z * r, wrapK2[2], wrap.w2)

      dirs[k * 3] = dir.x
      dirs[k * 3 + 1] = dir.y
      dirs[k * 3 + 2] = dir.z

      k++
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

    // юбка несёт позицию своей кромочной вершины домена детали — радиальный
    // сдвиг юбки (skirtDepthUnits) вносил бы фиктивную деталь на стенке
    detailPos[skirtIndex * 3] = detailPos[edgeIndex * 3]
    detailPos[skirtIndex * 3 + 1] = detailPos[edgeIndex * 3 + 1]
    detailPos[skirtIndex * 3 + 2] = detailPos[edgeIndex * 3 + 2]
    detailPos2[skirtIndex * 3] = detailPos2[edgeIndex * 3]
    detailPos2[skirtIndex * 3 + 1] = detailPos2[edgeIndex * 3 + 1]
    detailPos2[skirtIndex * 3 + 2] = detailPos2[edgeIndex * 3 + 2]

    // юбка несёт высоту кромки — радиальный сдвиг юбки не рельеф
    heights[skirtIndex] = heights[edgeIndex]

    // юбка несёт наклон полосы своей кромочной вершины
    midTilts[skirtIndex * 2] = midTilts[edgeIndex * 2]
    midTilts[skirtIndex * 2 + 1] = midTilts[edgeIndex * 2 + 1]
  }

  return center
}

/**
 * Fresh-вариант: аллоцирует новые типизированные массивы и геометрию —
 * эталон паритета для into-варианта (buildTerrainPatchInto) и его тестов;
 * продакшн-вызовов нет — TerrainSphere зовёт только into-вариант через пул.
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
  wrap: DetailWrap
): { geometry: BufferGeometry; center: Vector3 } {
  const vertexCount = terrainPatchVertexCount(segments)
  const positions = new Float32Array(vertexCount * 3)
  const detailPos = new Float32Array(vertexCount * 3)
  const detailPos2 = new Float32Array(vertexCount * 3)
  const heights = new Float32Array(vertexCount)
  const midTilts = new Float32Array(vertexCount * 2)

  const center = writeTerrainPatchAttributes(
    field,
    face,
    i,
    j,
    depth,
    segments,
    skirtDepthUnits,
    positions,
    detailPos,
    detailPos2,
    heights,
    midTilts,
    wrap
  )

  // раскладка бит-в-бит как у слота пула (см. TerrainPatchPool.createHandle):
  // InstancedBufferGeometry с одним инстансом и центром патча в инстансном атрибуте
  const geometry = new InstancedBufferGeometry()
  geometry.instanceCount = 1
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('detailPos', new BufferAttribute(detailPos, 3))
  geometry.setAttribute('detailPos2', new BufferAttribute(detailPos2, 3))
  geometry.setAttribute('height', new BufferAttribute(heights, 1))
  geometry.setAttribute('midTilt', new BufferAttribute(midTilts, 2))
  geometry.setAttribute('patchCenter', new InstancedBufferAttribute(new Float32Array([center.x, center.y, center.z]), 3))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()

  return { geometry, center }
}

/**
 * into-вариант для TerrainPatchPool: перезаписывает атрибуты уже
 * существующей геометрии handle на месте (split/merge квадродерева без
 * аллокаций типизированных массивов и BufferGeometry). Атрибуты и их размер
 * заведены пулом при acquire под тот же segments — здесь только запись.
 */
export function buildTerrainPatchInto(
  field: TerrainHeightField,
  face: number,
  i: number,
  j: number,
  depth: number,
  segments: number,
  skirtDepthUnits: number,
  handle: { mesh: Mesh; geometry: InstancedBufferGeometry },
  wrap: DetailWrap
): void {
  const { geometry, mesh } = handle
  const positions = geometry.getAttribute('position') as BufferAttribute
  const detailPos = geometry.getAttribute('detailPos') as BufferAttribute
  const detailPos2 = geometry.getAttribute('detailPos2') as BufferAttribute
  const height = geometry.getAttribute('height') as BufferAttribute
  const midTilt = geometry.getAttribute('midTilt') as BufferAttribute

  const center = writeTerrainPatchAttributes(
    field,
    face,
    i,
    j,
    depth,
    segments,
    skirtDepthUnits,
    positions.array as Float32Array,
    detailPos.array as Float32Array,
    detailPos2.array as Float32Array,
    height.array as Float32Array,
    midTilt.array as Float32Array,
    wrap
  )

  // центр патча — инстансный атрибут (один элемент): его пишет вызывающий,
  // ядро сборки центр только возвращает
  const patchCenter = geometry.getAttribute('patchCenter') as BufferAttribute
  ;(patchCenter.array as Float32Array).set([center.x, center.y, center.z])
  patchCenter.needsUpdate = true

  positions.needsUpdate = true
  detailPos.needsUpdate = true
  detailPos2.needsUpdate = true
  height.needsUpdate = true
  midTilt.needsUpdate = true
  geometry.computeBoundingSphere()
  mesh.position.copy(center)
}
