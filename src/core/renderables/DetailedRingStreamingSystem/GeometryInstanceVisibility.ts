import { BufferAttribute, Camera, Frustum, InstancedBufferAttribute, InstancedMesh, Matrix4 } from 'three'

/** Stable CPU allocation slots, compacted into the mesh's existing GPU buffers. */
export class GeometryInstanceVisibility {
  public readonly matrix: InstancedBufferAttribute
  public readonly attributes = new Map<string, InstancedBufferAttribute>()
  private readonly slots: Uint32Array
  private readonly versions = new WeakMap<InstancedBufferAttribute, number>()
  private readonly projection = new Matrix4()
  private readonly frustum = new Frustum()
  private position?: ReturnType<InstancedMesh['geometry']['getAttribute']>
  private positionVersion = -1
  private radius = 0
  private visibleCount = -1

  public constructor(private readonly mesh: InstancedMesh) {
    // These clones stay on the CPU. The original render attributes retain their
    // identity, geometry-swap behavior and scene-owned GPU disposal lifecycle.
    this.matrix = new InstancedBufferAttribute(mesh.instanceMatrix.array.slice(), 16)
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      if (attribute instanceof InstancedBufferAttribute) {
        this.attributes.set(name, new InstancedBufferAttribute(attribute.array.slice(), attribute.itemSize, attribute.normalized, attribute.meshPerAttribute))
      }
    }
    this.slots = new Uint32Array(this.matrix.count)
  }

  public update(camera: Camera, count: number, shapeAmplitude: number): void {
    const mesh = this.mesh, position = mesh.geometry.getAttribute('position')
    const positionVersion = position instanceof BufferAttribute ? position.version : position.data.version
    if (position !== this.position || positionVersion !== this.positionVersion) {
      this.radius = 0
      for (let i = 0; i < position.count; i++) {
        this.radius = Math.max(this.radius, Math.hypot(position.getX(i), position.getY(i), position.getZ(i)))
      }
      this.position = position
      this.positionVersion = positionVersion
    }

    // Bound the radial residual in AsteroidShape.fbmGrad. Each simplex corner
    // is 42*(0.6-r*r)^4*dot(p,x), |p| <= 1.001. Four corners bound snoiseGrad
    // by 3.52; octave weights 0.5+0.25 bound fbm by 2.64. Use 4 for margin.
    // An origin-centered sphere also encloses off-center models at every spin.
    const radius = this.radius * (1 + 4 * Math.abs(shapeAmplitude))
    mesh.updateWorldMatrix(true, false)
    this.projection.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
    this.projection.premultiply(camera.projectionMatrix)
    this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem)
    const matrices = this.matrix.array, origins = this.attributes.get('instanceOrigin')!.array
    let visibleCount = 0, changed = false
    for (let slot = 0; slot < count; slot++) {
      const m = slot * 16, o = slot * 3
      const a = matrices[m], b = matrices[m + 1], c = matrices[m + 2]
      const d = matrices[m + 4], e = matrices[m + 5], f = matrices[m + 6]
      const g = matrices[m + 8], h = matrices[m + 9], i = matrices[m + 10]
      // Match the shader's rejection of freed/degenerate slots.
      if (Math.abs(a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)) < 1e-20) continue
      const x = matrices[m + 12] + origins[o], y = matrices[m + 13] + origins[o + 1], z = matrices[m + 14] + origins[o + 2]
      const epsilon = 1e-5 * (1 + Math.abs(x) + Math.abs(y) + Math.abs(z))
      let visible = true
      for (const plane of this.frustum.planes) {
        const n = plane.normal
        // Support of the transformed sphere along this plane normal. Unlike
        // max column length, this remains conservative under scale and shear.
        const extent = radius * Math.hypot(a * n.x + b * n.y + c * n.z, d * n.x + e * n.y + f * n.z, g * n.x + h * n.y + i * n.z)
        if (n.x * x + n.y * y + n.z * z + plane.constant < -extent - epsilon) { visible = false; break }
      }
      if (!visible) continue
      if (this.slots[visibleCount] !== slot) changed = true
      this.slots[visibleCount++] = slot
    }
    changed ||= visibleCount !== this.visibleCount
    this.visibleCount = visibleCount
    mesh.count = visibleCount
    this.copyVisible(this.matrix, mesh.instanceMatrix, changed)
    for (const [name, source] of this.attributes) {
      const target = mesh.geometry.getAttribute(name)
      if (target instanceof InstancedBufferAttribute) this.copyVisible(source, target, changed)
    }
  }

  private copyVisible(source: InstancedBufferAttribute, target: InstancedBufferAttribute, changed: boolean): void {
    if (!changed && this.versions.get(source) === source.version) return
    this.versions.set(source, source.version)
    const size = source.itemSize, src = source.array, dst = target.array
    for (let i = 0; i < this.visibleCount; i++) {
      const offset = this.slots[i] * size
      for (let j = 0; j < size; j++) dst[i * size + j] = src[offset + j]
    }
    // This prefix supersedes pending uploads, including when several view
    // updates occur before a render. Unused tail slots are outside mesh.count.
    target.clearUpdateRanges()
    if (this.visibleCount > 0) {
      target.addUpdateRange(0, this.visibleCount * size)
      target.needsUpdate = true
    }
  }
}
