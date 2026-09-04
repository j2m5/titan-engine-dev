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

/** OBJ, если есть строки `v `/`f `, иначе plate-таблица */
export function parseShapeMesh(text: string): RawMesh {
  return /^\s*v\s/m.test(text) ? parseObjMesh(text) : parsePlateMesh(text)
}

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
export function decimateToTriangles(positions: Float32Array, indices: Uint32Array, targetTriangles: number): ShapeModelData {
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
