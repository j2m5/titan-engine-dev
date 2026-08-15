import { BufferAttribute, SphereGeometry, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { TerrainHeightField } from './TerrainHeightField'

/**
 * Плотная сфера с честным радиальным смещением r = R + h(dir̂) из канонического
 * TerrainHeightField — мешер и коллизия зовут одну функцию высоты.
 *
 * Высота берётся по направлению вершины, а не по её UV: дубли полюсной строки
 * (у SphereGeometry их width+1 с разными u) получают одинаковый радиус — полюс
 * без трещины. Нормали радиальные: весь наклон шейдит slope-карта (USE_SLOPE),
 * наклон вершинных нормалей считал бы низкие частоты дважды и алиасил.
 *
 * circumscribe старой сферы не применяется: поправка на фасетку тонет в
 * амплитуде рельефа.
 */
export function buildDisplacedSphere(field: TerrainHeightField, segments: number): SphereGeometry {
  const geometry = new SphereGeometry(toThreeJSUnits(field.radiusKm), segments, segments)
  const positions = geometry.getAttribute('position') as BufferAttribute

  const dir = new Vector3()

  for (let i = 0; i < positions.count; i++) {
    dir.set(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize()

    const r = field.surfaceRadiusUnits(dir)
    positions.setXYZ(i, dir.x * r, dir.y * r, dir.z * r)
  }

  positions.needsUpdate = true
  geometry.computeBoundingSphere()

  return geometry
}
