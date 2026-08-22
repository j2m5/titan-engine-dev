import { BufferAttribute, BufferGeometry, Mesh, Vector2, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { cubeFaceDirection } from './cubeSphere'
import { wrapIndex, wrappedComponent, type DetailWrap } from './detailWrap'
import type { TerrainHeightField } from './TerrainHeightField'

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

const POLE_EPSILON = 1e-9

/**
 * Ядро сборки RTC-патча (face, i, j) глубины depth: пишет position/normal/uv
 * в переданные массивы (уже нужного размера — вызывающий считает
 * vertexCount) и возвращает RTC-центр. Общее для fresh-варианта (аллоцирует
 * массивы сам) и into-варианта пула (переиспользует буферы существующей
 * геометрии без аллокаций).
 *
 * Позиции хранятся ОТНОСИТЕЛЬНО центра патча (центр — в position меша),
 * больших чисел во float32 нет, катастрофическое сокращение происходит в f64
 * на CPU при сборке modelViewMatrix. Высота — те же канонические
 * dirToUv/sampleMeters, что использует surfaceRadiusUnits (мешер и коллизия
 * читают одни данные одной формулой; мешер зовёт dirToUv один раз на
 * вершину, не через surfaceRadiusUnits повторно — см. перф-заметку в цикле
 * ниже). Нормали радиальные — наклон шейдит slope-карта. UV разворачивается
 * вокруг u центра патча (|u−uc| ≤ 0.5, допускается выход за [0,1] — текстуры
 * терраформных тел в RepeatWrapping); вершина ровно в полюсе берёт u центра
 * (там phi не определён). Развёртка шва корректна при азимутальном спане
 * патча < 180°: глубина ≥ 1; корень глубины 0 (этап 3б) потребует другой
 * развёртки. Юбка (skirtDepthUnits > 0) добавляет по периметру патча
 * вертикальную стенку — копию кромочных dir/normal/uv с радиусом, уменьшенным
 * на skirtDepthUnits: скрывает щель на стыке с соседним патчем другой
 * глубины квадродерева без необходимости совпадения тесселяций.
 *
 * detailPos/detailPos2 — тело-локальная позиция вершины (dir·r, ДО вычитания
 * center) минус k·W домена детали (см. detailWrap.ts), k общий на весь патч
 * и берётся от центра патча — иначе обёртка рвала бы треугольники внутри
 * патча. Два набора — под два слоя детали (40 м / 7 м), каждый со своим W.
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
  normals: Float32Array,
  uvs: Float32Array,
  detailPos: Float32Array,
  detailPos2: Float32Array,
  wrap: DetailWrap
): Vector3 {
  const patches = 1 << depth
  const span = 2 / patches
  const s0 = -1 + i * span
  const t0 = -1 + j * span

  const dir = new Vector3()
  const uv = new Vector2()

  const centerDir = cubeFaceDirection(face, s0 + span / 2, t0 + span / 2, new Vector3())
  const center = centerDir.clone().multiplyScalar(field.surfaceRadiusUnits(centerDir))
  const centerU = field.dirToUv(centerDir, new Vector2()).x

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

  let k = 0
  for (let b = 0; b <= segments; b++) {
    for (let a = 0; a <= segments; a++) {
      cubeFaceDirection(face, s0 + (span * a) / segments, t0 + (span * b) / segments, dir)

      // dirToUv один раз на вершину: surfaceRadiusUnits(dir) внутри тоже звал бы
      // его повторно (heightMeters → dirToUv) — 1.62М лишних atan2+acos на сборке
      field.dirToUv(dir, uv)
      const heightMeters = field.sampleMeters(uv.x, uv.y)
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

      normals[k * 3] = dir.x
      normals[k * 3 + 1] = dir.y
      normals[k * 3 + 2] = dir.z

      const u = Math.abs(dir.y) >= 1 - POLE_EPSILON ? centerU : uv.x - Math.round(uv.x - centerU)
      uvs[k * 2] = u
      // Текстурное v = 1 − v карты: dirToUv отдаёт v в координатах карты
      // (строка 0 = север), а загрузчик текстур флипует изображение (север =
      // v 1). Этот атрибут сейчас мёртв для рендера (фрагментник считает uv
      // сам, см. USE_TERRAIN_UV в PlanetShaderTemplate) — но незеркальный он
      // был бы миной для будущего потребителя вершинных uv.
      uvs[k * 2 + 1] = 1 - uv.y

      k++
    }
  }

  // юбка: копия кромочной вершины (dir/normal/uv), радиус кромки минус
  // skirtDepthUnits. Вычитание нормали (=dir) из УЖЕ квантованной позиции
  // кромки, а не пересборка dir·(r−skirtDepthUnits) заново, — общая ошибка
  // округления кромочной позиции входит в обе вершины одинаково и почти
  // полностью сокращается в разности длин edge/skirt (см. тест «юбочная
  // вершина ниже своей кромочной ровно на skirtDepthUnits»); независимый
  // пересчёт этого сокращения не даёт.
  for (let ring = 0; ring < ringCount; ring++) {
    const edgeIndex = ringGridIndex(ring, segments)
    const skirtIndex = gridCount + ring

    const nx = normals[edgeIndex * 3]
    const ny = normals[edgeIndex * 3 + 1]
    const nz = normals[edgeIndex * 3 + 2]

    positions[skirtIndex * 3] = positions[edgeIndex * 3] - nx * skirtDepthUnits
    positions[skirtIndex * 3 + 1] = positions[edgeIndex * 3 + 1] - ny * skirtDepthUnits
    positions[skirtIndex * 3 + 2] = positions[edgeIndex * 3 + 2] - nz * skirtDepthUnits

    normals[skirtIndex * 3] = nx
    normals[skirtIndex * 3 + 1] = ny
    normals[skirtIndex * 3 + 2] = nz

    uvs[skirtIndex * 2] = uvs[edgeIndex * 2]
    uvs[skirtIndex * 2 + 1] = uvs[edgeIndex * 2 + 1]

    // юбка несёт позицию своей кромочной вершины домена детали — радиальный
    // сдвиг юбки (skirtDepthUnits) вносил бы фиктивную деталь на стенке
    detailPos[skirtIndex * 3] = detailPos[edgeIndex * 3]
    detailPos[skirtIndex * 3 + 1] = detailPos[edgeIndex * 3 + 1]
    detailPos[skirtIndex * 3 + 2] = detailPos[edgeIndex * 3 + 2]
    detailPos2[skirtIndex * 3] = detailPos2[edgeIndex * 3]
    detailPos2[skirtIndex * 3 + 1] = detailPos2[edgeIndex * 3 + 1]
    detailPos2[skirtIndex * 3 + 2] = detailPos2[edgeIndex * 3 + 2]
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
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const detailPos = new Float32Array(vertexCount * 3)
  const detailPos2 = new Float32Array(vertexCount * 3)

  const center = writeTerrainPatchAttributes(
    field,
    face,
    i,
    j,
    depth,
    segments,
    skirtDepthUnits,
    positions,
    normals,
    uvs,
    detailPos,
    detailPos2,
    wrap
  )

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('detailPos', new BufferAttribute(detailPos, 3))
  geometry.setAttribute('detailPos2', new BufferAttribute(detailPos2, 3))
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
  handle: { mesh: Mesh; geometry: BufferGeometry },
  wrap: DetailWrap
): void {
  const { geometry, mesh } = handle
  const positions = geometry.getAttribute('position') as BufferAttribute
  const normals = geometry.getAttribute('normal') as BufferAttribute
  const uvs = geometry.getAttribute('uv') as BufferAttribute
  const detailPos = geometry.getAttribute('detailPos') as BufferAttribute
  const detailPos2 = geometry.getAttribute('detailPos2') as BufferAttribute

  const center = writeTerrainPatchAttributes(
    field,
    face,
    i,
    j,
    depth,
    segments,
    skirtDepthUnits,
    positions.array as Float32Array,
    normals.array as Float32Array,
    uvs.array as Float32Array,
    detailPos.array as Float32Array,
    detailPos2.array as Float32Array,
    wrap
  )

  positions.needsUpdate = true
  normals.needsUpdate = true
  uvs.needsUpdate = true
  detailPos.needsUpdate = true
  detailPos2.needsUpdate = true
  geometry.computeBoundingSphere()
  mesh.position.copy(center)
}
