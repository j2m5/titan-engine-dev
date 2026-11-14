import { IcosahedronGeometry, Vector3 } from 'three'

/** Shared angular chunks. Equal input vertices deform identically, including duplicated face corners. */
export function createBoulderGeometry(variant: number): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(1, 1)
  const positions = geometry.getAttribute('position'),
    p = new Vector3()
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i)
    const r = 0.87 + 0.09 * Math.sin(p.x * 4.1 + p.y * 2.7 + p.z * 3.3 + variant * 2.4)
    p.multiplyScalar(r)
    // Broad fracture planes and asymmetric shoulders, rather than a rounded noise sphere.
    p.y = Math.min(p.y, 0.62 + 0.14 * p.x - 0.12 * p.z + 0.04 * variant)
    p.x = Math.min(p.x, 0.76 - 0.12 * p.y + 0.06 * variant)
    p.z = Math.max(p.z, -0.74 + 0.13 * p.y - 0.035 * variant)
    positions.setXYZ(i, p.x, p.y, p.z)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
