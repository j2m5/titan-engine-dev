import { BufferGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3, type Material } from 'three'
import type { RingMoonlet } from '@/core/models/types'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const UP = new Vector3(0, 1, 0)

/**
 * Матрица инстанса лунки в кольцевых координатах (лист — плоскость XZ):
 * позиция на орбите по азимуту, поворот вокруг нормали кольца на −θ
 * (детерминирован азимутом — лунка не вращается), равномерный масштаб
 * «радиус лунки / радиус геометрии» (геометрия — радиуса asteroidSize, как
 * у архетипов камней).
 */
export function moonletMatrix(moonlet: RingMoonlet, asteroidSize: number, target: Matrix4 = new Matrix4()): Matrix4 {
  const theta = (moonlet.azimuthDeg * Math.PI) / 180
  const r = toThreeJSUnits(moonlet.radiusKm)
  const s = toThreeJSUnits(moonlet.sizeKm / 2) / asteroidSize
  return target.compose(
    new Vector3(r * Math.cos(theta), 0, r * Math.sin(theta)),
    new Quaternion().setFromAxisAngle(UP, -theta),
    new Vector3(s, s, s)
  )
}

/**
 * Лунка — один инстанс материала ближних камней: освещение, тень планеты,
 * planetshine, подсветка от кольца и туман пыли — общие с камнями. Атрибуты
 * источника (position/normal/surfaceData/индекс) — по ссылке, пер-инстансные
 * атрибуты материала L0 — свои: instanceFade = 1 (дизер не режет),
 * instanceOrigin = 0 (у колец плавающего начала нет).
 */
export function createMoonletMesh(source: BufferGeometry, material: Material, moonlet: RingMoonlet, asteroidSize: number): InstancedMesh {
  const geometry = new BufferGeometry()
  for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.getAttribute(name))
  if (source.getIndex() !== null) geometry.setIndex(source.getIndex())
  geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array([1]), 1))
  geometry.setAttribute('instanceOrigin', new InstancedBufferAttribute(new Float32Array(3), 3))

  const mesh = new InstancedMesh(geometry, material, 1)
  mesh.setMatrixAt(0, moonletMatrix(moonlet, asteroidSize))
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  mesh.name = `Moonlet:${moonlet.model}`
  return mesh
}
