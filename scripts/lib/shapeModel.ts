import { BufferAttribute, BufferGeometry } from 'three'
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ShapeModelData } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'

/**
 * Подготовка реальной модели формы малого тела к роли архетипа кольца:
 * разбор OBJ или табличной plate-модели PDS, центрирование по объёмному
 * центроиду, нормировка максимального радиуса в 1, прореживание до двух
 * ярусов и сглаженные нормали. Чистые функции — тестируются на синтетике.
 */

export interface RawMesh {
  positions: number[]
  indices: number[]
}

/**
 * Целевые треугольники ярусов. Процедурные архетипы — икосферы detail 3/4 из
 * three (20·(detail+1)² = 320/500 треугольников); реальная модель несёт больше
 * формы, поэтому бюджет вдвое-вчетверо выше, но всё ещё дешёвый для инстансинга.
 */
export const TIER_TRIANGLES = { l0: 640, near: 2000 } as const

/**
 * Разбор Wavefront OBJ: строки `v x y z` и `f a b c [d…]` (индексы 1-based, с
 * возможными `/vt/vn`, многоугольники триангулируются веером).
 */
export function parseObjMesh(text: string): RawMesh {
  const positions: number[] = []
  const indices: number[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/)
      positions.push(Number(x), Number(y), Number(z))
    } else if (line.startsWith('f ')) {
      const verts = line
        .split(/\s+/)
        .slice(1)
        .map((token) => Number(token.split('/')[0]) - 1)
      for (let i = 1; i + 1 < verts.length; i++) indices.push(verts[0], verts[i], verts[i + 1])
    }
  }
  return { positions, indices }
}

/**
 * Разбор табличной plate-модели PDS: первая непустая строка `nv nf`, затем nv
 * строк вершин (`[i] x y z`) и nf строк граней (`[i] a b c`, 1-based).
 * Необязательный ведущий номер строки распознаётся по числу токенов.
 */
export function parsePlateMesh(text: string): RawMesh {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
  const [nvRaw, nfRaw] = lines[0].split(/\s+/)
  const nv = Number(nvRaw)
  const nf = Number(nfRaw)
  if (!Number.isInteger(nv) || !Number.isInteger(nf) || lines.length < 1 + nv + nf) {
    throw new Error('plate model: bad header or truncated body')
  }
  const positions: number[] = []
  for (let i = 0; i < nv; i++) {
    const tokens = lines[1 + i].split(/\s+/).map(Number)
    const xyz = tokens.length >= 4 ? tokens.slice(1, 4) : tokens.slice(0, 3)
    positions.push(xyz[0], xyz[1], xyz[2])
  }
  const indices: number[] = []
  for (let i = 0; i < nf; i++) {
    const tokens = lines[1 + nv + i].split(/\s+/).map(Number)
    const abc = tokens.length >= 4 ? tokens.slice(1, 4) : tokens.slice(0, 3)
    indices.push(abc[0] - 1, abc[1] - 1, abc[2] - 1)
  }
  return { positions, indices }
}

/**
 * Разбор таблицы радиусов PDS (модели Томаса: Гаспра, Ида, Матильда, Деймос):
 * строки `lon lat r` или `lat lon r` на сетке 5° (73 долготы × 37 широт),
 * порядок колонок определяется по диапазонам ([0, 360] — долгота, [−90, 90] —
 * широта). Сетка триангулируется: полюса схлопнуты в одну вершину, шов
 * долготы 360 = 0 не дублируется. Планетоцентрические координаты:
 * x = r·cos(lat)·cos(lon), y = r·cos(lat)·sin(lon), z = r·sin(lat).
 */
export function parseRadiusGrid(text: string): RawMesh {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map((l) => l.split(/\s+/).map(Number))
    .filter((t) => t.length >= 3 && t.slice(0, 3).every(Number.isFinite))
  if (rows.length === 0) throw new Error('radius grid: no rows')

  const range = (col: number): [number, number] => {
    let lo = Infinity
    let hi = -Infinity
    for (const r of rows) {
      lo = Math.min(lo, r[col])
      hi = Math.max(hi, r[col])
    }
    return [lo, hi]
  }
  const lonCol = range(0)[1] > 180 ? 0 : 1
  const latCol = 1 - lonCol

  // Радиус по (lon mod 360, lat): последняя точка на шве 360 совпадает с 0
  const radii = new Map<string, number>()
  const lons = new Set<number>()
  const lats = new Set<number>()
  for (const r of rows) {
    const lon = ((r[lonCol] % 360) + 360) % 360
    const lat = r[latCol]
    lons.add(lon)
    lats.add(lat)
    radii.set(`${lon}|${lat}`, r[2])
  }
  const lonList = [...lons].sort((a, b) => a - b)
  const latList = [...lats].sort((a, b) => a - b).filter((lat) => lat > -90 && lat < 90)
  const hasSouth = lats.has(-90)
  const hasNorth = lats.has(90)
  if (lonList.length < 3 || latList.length < 1) throw new Error('radius grid: degenerate grid')

  const positions: number[] = []
  const toRad = Math.PI / 180
  const push = (lon: number, lat: number, r: number): number => {
    const cl = Math.cos(lat * toRad)
    positions.push(r * cl * Math.cos(lon * toRad), r * cl * Math.sin(lon * toRad), r * Math.sin(lat * toRad))
    return positions.length / 3 - 1
  }
  const radiusAt = (lon: number, lat: number): number => {
    const r = radii.get(`${lon}|${lat}`)
    if (r === undefined) throw new Error(`radius grid: missing sample lon=${lon} lat=${lat}`)
    return r
  }

  // Вершины поясов: index[latIdx][lonIdx]
  const ring: number[][] = latList.map((lat) => lonList.map((lon) => push(lon, lat, radiusAt(lon, lat))))
  const poleRadius = (lat: number): number => {
    let sum = 0
    for (const lon of lonList) sum += radiusAt(lon, lat)
    return sum / lonList.length
  }
  const south = hasSouth ? push(0, -90, poleRadius(-90)) : -1
  const north = hasNorth ? push(0, 90, poleRadius(90)) : -1

  const indices: number[] = []
  const L = lonList.length
  for (let j = 0; j + 1 < ring.length; j++) {
    for (let i = 0; i < L; i++) {
      const a = ring[j][i]
      const b = ring[j][(i + 1) % L]
      const c = ring[j + 1][(i + 1) % L]
      const d = ring[j + 1][i]
      indices.push(a, b, c, a, c, d)
    }
  }
  if (south >= 0) for (let i = 0; i < L; i++) indices.push(south, ring[0][(i + 1) % L], ring[0][i])
  if (north >= 0) {
    const top = ring[ring.length - 1]
    for (let i = 0; i < L; i++) indices.push(north, top[i], top[(i + 1) % L])
  }
  return { positions, indices }
}

/** Таблица радиусов: нет строк v/f, нет заголовка `nv nf`, три числовые колонки */
const looksLikeRadiusGrid = (text: string): boolean => {
  const first = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'))
  if (!first) return false
  const tokens = first.split(/\s+/)
  return tokens.length === 3 && tokens.every((t) => Number.isFinite(Number(t)))
}

/** OBJ (строки `v `/`f `), таблица радиусов (три колонки без заголовка) или plate-таблица */
export function parseShapeMesh(text: string): RawMesh {
  if (/^\s*v\s/m.test(text)) return parseObjMesh(text)
  if (looksLikeRadiusGrid(text)) return parseRadiusGrid(text)
  return parsePlateMesh(text)
}

/**
 * Быстрое предпрореживание сеткой ячеек (vertex clustering): вершины в одной
 * ячейке куба resolution³ по габариту сливаются в среднюю, вырожденные
 * треугольники выбрасываются. O(n), нужно для многомиллионных моделей
 * (Фобос — 3.1 млн граней), где SimplifyModifier непрактичен напрямую.
 */
export function clusterDecimate(positions: Float32Array, indices: Uint32Array, resolution: number): ShapeModelData {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  const size = max.map((m, k) => Math.max(m - min[k], 1e-9))
  const cellOf = new Int32Array(positions.length / 3)
  const cellIndex = new Map<number, number>()
  const sums: number[] = []
  const counts: number[] = []
  for (let v = 0; v < positions.length / 3; v++) {
    const cx = Math.min(resolution - 1, Math.floor(((positions[v * 3] - min[0]) / size[0]) * resolution))
    const cy = Math.min(resolution - 1, Math.floor(((positions[v * 3 + 1] - min[1]) / size[1]) * resolution))
    const cz = Math.min(resolution - 1, Math.floor(((positions[v * 3 + 2] - min[2]) / size[2]) * resolution))
    const key = (cx * resolution + cy) * resolution + cz
    let idx = cellIndex.get(key)
    if (idx === undefined) {
      idx = counts.length
      cellIndex.set(key, idx)
      sums.push(0, 0, 0)
      counts.push(0)
    }
    cellOf[v] = idx
    sums[idx * 3] += positions[v * 3]
    sums[idx * 3 + 1] += positions[v * 3 + 1]
    sums[idx * 3 + 2] += positions[v * 3 + 2]
    counts[idx]++
  }
  const outPositions = new Float32Array(counts.length * 3)
  for (let c = 0; c < counts.length; c++) {
    outPositions[c * 3] = sums[c * 3] / counts[c]
    outPositions[c * 3 + 1] = sums[c * 3 + 1] / counts[c]
    outPositions[c * 3 + 2] = sums[c * 3 + 2] / counts[c]
  }
  const outIndices: number[] = []
  for (let t = 0; t < indices.length; t += 3) {
    const a = cellOf[indices[t]]
    const b = cellOf[indices[t + 1]]
    const c = cellOf[indices[t + 2]]
    if (a !== b && b !== c && a !== c) outIndices.push(a, b, c)
  }
  return { positions: outPositions, normals: new Float32Array(0), indices: Uint32Array.from(outIndices) }
}

/** Порог граней, выше которого перед SimplifyModifier идёт clusterDecimate */
export const CLUSTER_THRESHOLD_TRIANGLES = 120000
/** Разрешение сетки предпрореживания: ~50k граней на выходе у замкнутого тела */
const CLUSTER_RESOLUTION = 96

/**
 * Центрирование по объёмному центроиду (сумма ориентированных тетраэдров
 * граней с началом координат) и нормировка максимального радиуса в 1 — та же
 * нормировка, что у процедурных архетипов. Возвращает новую копию позиций.
 */
export function centerAndNormalize(mesh: RawMesh): Float32Array {
  const p = mesh.positions
  let volume = 0
  let cx = 0
  let cy = 0
  let cz = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3
    const b = mesh.indices[t + 1] * 3
    const c = mesh.indices[t + 2] * 3
    const v =
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6
    volume += v
    cx += (v * (p[a] + p[b] + p[c])) / 4
    cy += (v * (p[a + 1] + p[b + 1] + p[c + 1])) / 4
    cz += (v * (p[a + 2] + p[b + 2] + p[c + 2])) / 4
  }
  // Вырожденный объём (открытый/плоский меш) → центроид вершин
  if (Math.abs(volume) < 1e-12) {
    cx = cy = cz = 0
    const n = p.length / 3
    for (let i = 0; i < p.length; i += 3) {
      cx += p[i] / n
      cy += p[i + 1] / n
      cz += p[i + 2] / n
    }
  } else {
    cx /= volume
    cy /= volume
    cz /= volume
  }

  const out = new Float32Array(p.length)
  let maxR = 0
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i] - cx
    out[i + 1] = p[i + 1] - cy
    out[i + 2] = p[i + 2] - cz
    maxR = Math.max(maxR, Math.hypot(out[i], out[i + 1], out[i + 2]))
  }
  if (maxR > 0) for (let i = 0; i < out.length; i++) out[i] /= maxR
  return out
}

/**
 * Прореживание до целевого числа треугольников (SimplifyModifier из three:
 * снимает заданное число вершин; у замкнутого меша V ≈ F/2 + 2). Меш беднее
 * цели остаётся как есть. Нормали — сглаженные, из three (взвешены площадью).
 */
export function decimateToTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  targetTriangles: number,
  clusterThreshold: number = CLUSTER_THRESHOLD_TRIANGLES
): ShapeModelData {
  // Многомиллионные модели сначала грубо режутся сеткой ячеек — O(n)
  if (indices.length / 3 > clusterThreshold) {
    const clustered = clusterDecimate(positions, indices, CLUSTER_RESOLUTION)
    positions = clustered.positions
    indices = clustered.indices
  }

  const source = new BufferGeometry()
  source.setAttribute('position', new BufferAttribute(positions.slice(), 3))
  source.setIndex(new BufferAttribute(indices.slice(), 1))
  // Слить дубли вершин ДО расчёта бюджета: у неиндексированных/расшитых мешей
  // вершин втрое больше граней, и счёт по ним снял бы всё тело целиком
  let geometry = mergeVertices(source)

  const currentTriangles = geometry.getIndex()!.count / 3
  if (currentTriangles > targetTriangles) {
    const vertexCount = geometry.getAttribute('position').count
    const targetVertices = Math.max(4, Math.round(targetTriangles / 2 + 2))
    const removeCount = Math.max(0, vertexCount - targetVertices)
    geometry = new SimplifyModifier().modify(geometry, removeCount)
  }
  geometry.computeVertexNormals()

  const pos = geometry.getAttribute('position').array as Float32Array
  const nor = geometry.getAttribute('normal').array as Float32Array
  const index = geometry.getIndex()
  const idx = index ? Uint32Array.from(index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i)
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nor), indices: idx }
}

/** Два яруса из подготовленного (центрированного, нормированного) меша */
export function buildShapeTiers(positions: Float32Array, indices: Uint32Array): { l0: ShapeModelData; near: ShapeModelData } {
  return {
    l0: decimateToTriangles(positions, indices, TIER_TRIANGLES.l0),
    near: decimateToTriangles(positions, indices, TIER_TRIANGLES.near)
  }
}
