import { BufferAttribute, BufferGeometry, Vector2, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { cubeFaceDirection } from './cubeSphere'
import type { TerrainHeightField } from './TerrainHeightField'

/**
 * Общий индекс сетки патча: у всех патчей одинаковая топология, поэтому один
 * BufferAttribute шарится по ссылке. Обмотка CCW при взгляде снаружи —
 * базисы граней правые (u×v = n).
 */
export function buildPatchIndex(segments: number): BufferAttribute {
  const indices = new Uint16Array(segments * segments * 6)
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

  return new BufferAttribute(indices, 1)
}

const POLE_EPSILON = 1e-9

/**
 * RTC-геометрия патча (face, i, j) глубины depth: позиции хранятся
 * ОТНОСИТЕЛЬНО центра патча (центр — в position меша), больших чисел во
 * float32 нет, катастрофическое сокращение происходит в f64 на CPU при
 * сборке modelViewMatrix. Высота — те же канонические dirToUv/sampleMeters,
 * что использует surfaceRadiusUnits (мешер и коллизия читают одни данные
 * одной формулой; мешер зовёт dirToUv один раз на вершину, не через
 * surfaceRadiusUnits повторно — см. перф-заметку в цикле ниже). Нормали
 * радиальные — наклон шейдит slope-карта. UV разворачивается вокруг u
 * центра патча (|u−uc| ≤ 0.5, допускается выход за [0,1] — текстуры
 * терраформных тел в RepeatWrapping); вершина ровно в полюсе берёт u центра
 * (там phi не определён). Развёртка шва корректна при азимутальном спане
 * патча < 180°: глубина ≥ 1; корень глубины 0 (этап 3б) потребует другой
 * развёртки.
 */
export function buildTerrainPatchGeometry(
  field: TerrainHeightField,
  face: number,
  i: number,
  j: number,
  depth: number,
  segments: number,
  index: BufferAttribute
): { geometry: BufferGeometry; center: Vector3 } {
  const patches = 1 << depth
  const span = 2 / patches
  const s0 = -1 + i * span
  const t0 = -1 + j * span

  const dir = new Vector3()
  const uv = new Vector2()

  const centerDir = cubeFaceDirection(face, s0 + span / 2, t0 + span / 2, new Vector3())
  const center = centerDir.clone().multiplyScalar(field.surfaceRadiusUnits(centerDir))
  const centerU = field.dirToUv(centerDir, new Vector2()).x

  const vertexCount = (segments + 1) * (segments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)

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

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()

  return { geometry, center }
}
