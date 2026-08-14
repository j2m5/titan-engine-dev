import { BufferAttribute, SphereGeometry, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from './heightMapFormat'

/**
 * Разрешение честной сферы рельефа. Машинерия, не визуальная ручка — потому
 * в коде, а не в renderingObject.data (конвенция колец). 1024 сегмента для
 * Луны ≈ 10.6 км/вершину на экваторе — ниже доложит карта через нормали,
 * а с этапа 3 — квадродерево.
 */
export const TERRAIN_SPHERE_SEGMENTS = 1024

/**
 * Билинейная выборка карты высот. u — долгота 0..1 с заворотом (шов нулевого
 * меридиана), v — широта: 0 = север (строка 0), 1 = юг, с клампом у полюсов.
 * Возвращает метры: min + raw/65535 × (max − min).
 */
export function sampleHeightMeters(map: HeightMapData, u: number, v: number): number {
  const x = (u - Math.floor(u)) * map.width
  const y = Math.min(Math.max(v, 0), 1) * (map.height - 1)

  const x0 = Math.floor(x) % map.width
  const x1 = (x0 + 1) % map.width
  const y0 = Math.min(Math.floor(y), map.height - 1)
  const y1 = Math.min(y0 + 1, map.height - 1)

  const fx = x - Math.floor(x)
  const fy = y - y0

  const h00 = map.data[y0 * map.width + x0]
  const h10 = map.data[y0 * map.width + x1]
  const h01 = map.data[y1 * map.width + x0]
  const h11 = map.data[y1 * map.width + x1]

  const raw = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy

  return map.minMeters + (raw / 65535) * (map.maxMeters - map.minMeters)
}

const UP = new Vector3(0, 1, 0)

/**
 * Плотная сфера с честным радиальным смещением r = R + h(dir).
 *
 * Нормали — из градиента карты, а не computeVertexNormals: у SphereGeometry
 * вершины шва нулевого меридиана дублированы, пофейсное усреднение даёт на
 * шве видимую линию. Аналитический базис восток/север — CPU-порт паттерна
 * heightNormalFunctions; в отличие от GPU-версии арки честные (деление на
 * cos широты), у полюсов базис вырожден — там нормаль остаётся радиальной.
 *
 * circumscribe старой сферы не применяется: поправка на фасетку тонет в
 * амплитуде рельефа.
 */
export function buildDisplacedSphere(radiusUnits: number, map: HeightMapData, segments: number): SphereGeometry {
  const geometry = new SphereGeometry(radiusUnits, segments, segments)
  const positions = geometry.getAttribute('position') as BufferAttribute
  const normals = geometry.getAttribute('normal') as BufferAttribute
  const uvs = geometry.getAttribute('uv') as BufferAttribute

  const dir = new Vector3()
  const east = new Vector3()
  const north = new Vector3()
  const normal = new Vector3()

  const du = 1 / map.width
  const dv = 1 / map.height
  const northArc = (Math.PI * radiusUnits) / map.height

  const heightUnits = (u: number, v: number): number => toThreeJSUnits(sampleHeightMeters(map, u, v) / 1000)

  for (let i = 0; i < positions.count; i++) {
    dir.set(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize()

    const u = uvs.getX(i)
    // у SphereGeometry uv.y = 1 на северном полюсе, у карты север — строка 0
    const v = 1 - uvs.getY(i)

    const r = radiusUnits + heightUnits(u, v)
    positions.setXYZ(i, dir.x * r, dir.y * r, dir.z * r)

    east.copy(UP).cross(dir)
    const cosLat = east.length()

    if (cosLat < 1e-4) {
      // полюс: тангенс вырожден, рельефная нормаль не определена
      normals.setXYZ(i, dir.x, dir.y, dir.z)
      continue
    }

    east.divideScalar(cosLat)
    north.copy(dir).cross(east)

    const eastArc = (2 * Math.PI * radiusUnits * cosLat) / map.width
    const gradEast = (heightUnits(u + du, v) - heightUnits(u - du, v)) / (2 * eastArc)
    const gradNorth = (heightUnits(u, v - dv) - heightUnits(u, v + dv)) / (2 * northArc)

    normal.copy(dir).addScaledVector(east, -gradEast).addScaledVector(north, -gradNorth)

    // гард против близких к полюсу вершин: если норма вектора слишком мала, падение
    // в numerics даёт NaN при нормализации. В этом случае остаются с радиальной нормалью
    if (normal.lengthSq() > 1e-12) {
      normal.normalize()
    } else {
      normal.copy(dir)
    }

    normals.setXYZ(i, normal.x, normal.y, normal.z)
  }

  positions.needsUpdate = true
  normals.needsUpdate = true
  geometry.computeBoundingSphere()

  return geometry
}
