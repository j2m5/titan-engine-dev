import { BufferGeometry, Float32BufferAttribute } from 'three'

class VolumetricRingGeometry extends BufferGeometry {
  public constructor(innerRadius: number, outerRadius: number, segments: number, thickness: number) {
    super()

    const vertices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    const halfThickness: number = thickness / 2

    for (let i: number = 0; i <= segments; i++) {
      const theta: number = (i / segments) * Math.PI * 2
      const sinTheta: number = Math.sin(theta)
      const cosTheta: number = Math.cos(theta)

      for (let j: number = -1; j <= 1; j += 2) {
        const zOffset: number = j * halfThickness

        vertices.push(innerRadius * cosTheta, innerRadius * sinTheta, zOffset)
        normals.push(cosTheta, sinTheta, 0)
        uvs.push(i / segments, j === -1 ? 0 : 1)

        vertices.push(outerRadius * cosTheta, outerRadius * sinTheta, zOffset)
        normals.push(cosTheta, sinTheta, 0)
        uvs.push(i / segments, j === -1 ? 0 : 1)
      }
    }

    for (let i: number = 0; i < segments; i++) {
      const offset: number = i * 4

      indices.push(offset, offset + 1, offset + 5)
      indices.push(offset, offset + 5, offset + 4)

      indices.push(offset + 2, offset + 3, offset + 7)
      indices.push(offset + 2, offset + 7, offset + 6)

      indices.push(offset, offset + 4, offset + 2)
      indices.push(offset + 4, offset + 6, offset + 2)

      indices.push(offset + 1, offset + 3, offset + 5)
      indices.push(offset + 5, offset + 3, offset + 7)
    }

    this.setIndex(indices)
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  }
}

export { VolumetricRingGeometry }
