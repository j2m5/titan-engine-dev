import { BufferAttribute, InstancedBufferGeometry } from 'three'

/** Единичный квад [-1, 1]² для инстанс-спрайтов блика; число инстансов ставит эффект по сетке */
export function createSpriteQuad(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.instanceCount = 0
  return geometry
}
