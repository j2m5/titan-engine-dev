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

/**
 * Плотная сфера с честным радиальным смещением r = R + h(dir).
 *
 * Нормали намеренно радиальные: весь наклон поверхности, включая частоты
 * масштаба вершинной сетки, шейдится попиксельно slope-картой (USE_SLOPE в
 * PlanetMaterial) — наклон вершинных нормалей считал бы низкие частоты дважды.
 * Вершинная выборка градиента к тому же алиасит: шаг сетки в разы крупнее
 * текселя карты, и высокочастотная кратерная мелочь заворачивалась в шум
 * у терминатора.
 *
 * circumscribe старой сферы не применяется: поправка на фасетку тонет в
 * амплитуде рельефа.
 */
export function buildDisplacedSphere(radiusUnits: number, map: HeightMapData, segments: number): SphereGeometry {
  const geometry = new SphereGeometry(radiusUnits, segments, segments)
  const positions = geometry.getAttribute('position') as BufferAttribute
  const uvs = geometry.getAttribute('uv') as BufferAttribute

  const dir = new Vector3()

  for (let i = 0; i < positions.count; i++) {
    dir.set(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize()

    const u = uvs.getX(i)
    // у SphereGeometry uv.y = 1 на северном полюсе, у карты север — строка 0
    const v = 1 - uvs.getY(i)

    const r = radiusUnits + toThreeJSUnits(sampleHeightMeters(map, u, v) / 1000)
    positions.setXYZ(i, dir.x * r, dir.y * r, dir.z * r)
  }

  positions.needsUpdate = true
  geometry.computeBoundingSphere()

  return geometry
}
