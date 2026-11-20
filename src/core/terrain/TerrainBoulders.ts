import {
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Sphere,
  Vector3,
  WebGLRenderer
} from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import {
  BOULDER_TEXTURE_METERS,
  TerrainBoulderMaterial,
  createBoulderContactMaterial
} from '@/core/materials/TerrainBoulderMaterial'
import { TerrainHeightField } from './TerrainHeightField'
import type { TerrainSurfacePatch } from './TerrainPatchGroup'
import { nodeKeyOf, TERRAIN_QUADTREE_MAX_LEVEL } from './terrainQuadtreeSelect'
import { TERRAIN_PATCH_SEGMENTS as SEGMENTS } from './cubeSphere'
import { boulderRandom as random, sampleBoulderTriangle } from './boulderScatter'
import { createBoulderGeometry } from './boulderGeometry'
import { TerrainBoulderObstacles, registerBoulderObstacles } from './TerrainBoulderObstacles'
import { wrapUnitsFor, WRAP_TILES } from './detailWrap'
import { TerrainBoulderShadows } from './TerrainBoulderShadows'

export const BOULDER_CAPACITY = 2048
export const BOULDER_RANGE_METERS = 1600
const UNIT = toThreeJSUnits(0.001)
const VARIANTS = 4,
  CACHE_LIMIT = 24,
  CELL_BUDGET = 512
const UP = new Vector3(0, 1, 0)
interface Boulder {
  matrix: Matrix4
  contact: Matrix4
  sphere: Sphere
  variant: number
  tint: number
  born: number
  distance: number
}
interface PatchDeposit {
  positions: ArrayLike<number>
  rocks: Boulder[]
  nextCell: number
  lastFrame: number
}

/** Bounded near-camera deposits on the actual settled triangles; no extra terrain attributes are retained. */
export class TerrainBoulders {
  private readonly group = new Group()
  private readonly material: TerrainBoulderMaterial
  private readonly sizeScale: number
  private readonly range: number
  private readonly shadows: TerrainBoulderShadows | null
  private readonly meshes: InstancedMesh[] = []
  private readonly contacts: InstancedMesh
  private readonly obstacles: TerrainBoulderObstacles
  private readonly unregister: () => void
  private readonly cache = new Map<number, PatchDeposit>()
  private readonly point = new Vector3()
  private readonly normal = new Vector3()
  private readonly dir = new Vector3()
  private readonly center = new Vector3()
  private readonly anchor = new Vector3()
  private readonly scale = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly yaw = new Quaternion()
  private readonly matrix = new Matrix4()
  private frame = 0
  private disposed = false
  public count = 0

  public constructor(
    private readonly host: Object3D,
    actor: object,
    private readonly field: TerrainHeightField,
    private readonly parentMaterial: ShaderMaterial,
    private readonly density: number,
    renderer?: WebGLRenderer
  ) {
    this.sizeScale = Math.max(0.1, Math.min(1, field.radiusKm / 2000))
    this.range = BOULDER_RANGE_METERS * UNIT * this.sizeScale
    this.material = new TerrainBoulderMaterial(parentMaterial, this.sizeScale)
    for (let i = 0; i < VARIANTS; i++) {
      const mesh = new InstancedMesh(createBoulderGeometry(i), this.material, BOULDER_CAPACITY)
      this.prepare(mesh)
      this.meshes.push(mesh)
    }
    this.contacts = new InstancedMesh(
      new PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      createBoulderContactMaterial(),
      BOULDER_CAPACITY
    )
    this.prepare(this.contacts)
    this.group.name = 'Talus boulders'
    // RenderableFactory discovers one receiver for all four instance materials.
    Object.assign(this.group, { sceneCloudReceiver: this.material.sceneCloudReceiver })
    this.host.add(this.group)
    this.obstacles = new TerrainBoulderObstacles(host)
    this.unregister = registerBoulderObstacles(actor, this.obstacles)
    this.shadows = renderer ? new TerrainBoulderShadows(host, renderer, this.meshes, this.sizeScale) : null
    this.shadows?.bind(parentMaterial)
    this.shadows?.bind(this.material)
  }

  private prepare(mesh: InstancedMesh): void {
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.geometry.setAttribute(
      'boulderState',
      new InstancedBufferAttribute(new Float32Array(BOULDER_CAPACITY * 2), 2).setUsage(DynamicDrawUsage)
    )
    this.group.add(mesh)
  }

  public update(patches: Iterable<TerrainSurfacePatch>, camera: Vector3, elapsed: number): void {
    if (this.disposed) return
    this.frame++
    // Avoid allocating deposits while the camera is far above the surface.
    if (
      camera.length() >
      toThreeJSUnits(this.field.radiusKm + this.field.maxHeightWithMidbandMeters / 1000) + this.range
    ) {
      this.hide()
      return
    }
    this.material.sync(this.parentMaterial)
    const candidates: { patch: TerrainSurfacePatch; distance: number }[] = []
    for (const patch of patches) {
      const mesh = patch.handle.mesh
      if (!mesh.visible || patch.address.level !== TERRAIN_QUADTREE_MAX_LEVEL || patch.morph > 0 || patch.target !== 0)
        continue
      const bounds = patch.handle.geometry.boundingSphere
      if (!bounds) continue
      this.center.copy(mesh.position).add(bounds.center)
      const distance = this.center.distanceTo(camera)
      if (distance > bounds.radius + this.range) continue
      candidates.push({ patch, distance })
    }
    candidates.sort((a, b) => a.distance - b.distance)
    let budget = CELL_BUDGET
    const visible: Boulder[] = []
    for (const { patch } of candidates.slice(0, CACHE_LIMIT)) {
      const { face, level, i, j } = patch.address
      const key = nodeKeyOf(face, level, i, j)
      const positions = patch.handle.geometry.getAttribute('position').array
      let deposit = this.cache.get(key)
      if (!deposit || deposit.positions !== positions) {
        deposit = { positions, rocks: [], nextCell: 0, lastFrame: this.frame }
        this.cache.set(key, deposit)
      }
      deposit.lastFrame = this.frame
      while (budget > 0 && deposit.nextCell < SEGMENTS * SEGMENTS * 2) {
        this.buildCandidate(patch, deposit, deposit.nextCell++, elapsed)
        budget--
      }
      for (const rock of deposit.rocks) {
        rock.distance = rock.sphere.center.distanceTo(camera)
        if (rock.distance < this.range) visible.push(rock)
      }
    }
    // Evict the least recently used patch, regardless of traversal order.
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].lastFrame - b[1].lastFrame)
      for (let i = 0; i < oldest.length - CACHE_LIMIT; i++) this.cache.delete(oldest[i][0])
    }
    for (const deposit of this.cache.values()) {
      if (deposit.lastFrame !== this.frame) for (const rock of deposit.rocks) rock.born = elapsed
    }
    visible.sort((a, b) => a.distance - b.distance)
    visible.length = Math.min(visible.length, BOULDER_CAPACITY)
    this.count = visible.length
    // RTC translation removes planetary-scale float32 quantization in both geometry and detail UVs.
    const snap = 256 * UNIT
    this.anchor.set(
      Math.round(camera.x / snap) * snap,
      Math.round(camera.y / snap) * snap,
      Math.round(camera.z / snap) * snap
    )
    this.group.position.copy(this.anchor)
    this.group.visible = this.count > 0
    this.material.origin.copy(this.anchor)
    const wrap1 = wrapUnitsFor(BOULDER_TEXTURE_METERS * this.sizeScale)
    const scale2 = this.parentMaterial.uniforms.uDetailScale2?.value as number | undefined
    const wrap2 = scale2 && scale2 > 0 ? WRAP_TILES / scale2 : wrapUnitsFor(7)
    this.wrapOrigin(this.material.detailOrigin, wrap1)
    this.wrapOrigin(this.material.detailOrigin2, wrap2)
    for (const mesh of this.meshes) mesh.count = 0
    this.contacts.count = 0
    const spheres: Sphere[] = []
    for (const rock of visible) {
      const t = Math.max(0, Math.min(1, (rock.distance / (UNIT * this.sizeScale) - 1100) / 500))
      const fade = (1 - t * t * (3 - 2 * t)) * Math.max(0, Math.min(1, (elapsed - rock.born - 0.05) / 0.45))
      this.write(this.meshes[rock.variant], rock.matrix, fade, rock.tint)
      this.write(this.contacts, rock.contact, fade, 1)
      // Installed before a newly created stone can become visible on the next frame.
      spheres.push(rock.sphere)
    }
    this.obstacles.spheres = spheres
    for (const mesh of [...this.meshes, this.contacts]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.geometry.getAttribute('boulderState').needsUpdate = true
    }
    const lightPosition = this.parentMaterial.uniforms.lightPosition?.value as Vector3 | undefined
    if (this.shadows && lightPosition) {
      this.host.worldToLocal(this.dir.copy(lightPosition)).sub(camera).normalize()
      this.shadows.update(camera, this.dir, this.anchor)
    } else this.shadows?.hide()
  }

  private wrapOrigin(out: Vector3, wrap: number): void {
    out.set(
      this.anchor.x - Math.round(this.anchor.x / wrap) * wrap,
      this.anchor.y - Math.round(this.anchor.y / wrap) * wrap,
      this.anchor.z - Math.round(this.anchor.z / wrap) * wrap
    )
  }

  private buildCandidate(patch: TerrainSurfacePatch, deposit: PatchDeposit, index: number, elapsed: number): void {
    const cell = Math.floor(index / 2),
      x = cell % SEGMENTS,
      y = Math.floor(cell / SEGMENTS)
    const { face, i, j } = patch.address
    const seed =
      Math.imul(face + 1, 73856093) ^
      Math.imul(i * SEGMENTS + x, 19349663) ^
      Math.imul(j * SEGMENTS + y, 83492791) ^
      Math.imul((index % 2) + 1, 1640531513)
    const chance = random(seed)
    if (chance >= this.density * 0.6) return
    const gx = x + 0.08 + 0.84 * random(seed + 1),
      gy = y + 0.08 + 0.84 * random(seed + 2)
    const margin = sampleBoulderTriangle(
      deposit.positions,
      SEGMENTS,
      gx,
      gy,
      patch.handle.mesh.position,
      this.point,
      this.normal
    )
    this.dir.copy(this.point).normalize()
    if (this.normal.dot(this.dir) < 0.75) return
    const water = this.field.midbandParams.waterLevelMeters
    if (water !== null && this.point.length() <= this.field.waterSurfaceRadiusUnits(water)) return
    const coverage = this.field.bedrockTalusCoverage(this.dir)
    if (chance >= this.density * 0.6 * coverage) return
    const radius = (1.4 + 8.6 * random(seed + 3) ** 4) * UNIT * this.sizeScale
    const sx = radius * (0.85 + 0.45 * random(seed + 4)),
      sz = radius * (0.75 + 0.4 * random(seed + 5))
    const contactRadius = 1.5 * Math.max(sx, sz)
    if (margin < contactRadius) return
    this.rotation
      .setFromUnitVectors(UP, this.normal)
      .multiply(this.yaw.setFromAxisAngle(UP, random(seed + 6) * 2 * Math.PI))
    this.scale.set(sx, radius * (0.7 + 0.35 * random(seed + 7)), sz)
    const position = this.point.clone().addScaledVector(this.normal, 0.12 * radius)
    const matrix = new Matrix4().compose(position, this.rotation, this.scale)
    const sphere = new Sphere(
      position,
      1.5 * Math.max(this.scale.x, this.scale.y, this.scale.z) + UNIT * this.sizeScale
    )
    const contact = new Matrix4().compose(
      this.point.clone().addScaledVector(this.normal, 0.02 * UNIT),
      this.rotation,
      this.scale.set(contactRadius, 1, contactRadius)
    )
    deposit.rocks.push({
      matrix,
      contact,
      sphere,
      variant: Math.floor(random(seed + 8) * VARIANTS),
      tint: 0.8 + 0.3 * random(seed + 9),
      born: elapsed,
      distance: 0
    })
  }

  private write(mesh: InstancedMesh, source: Matrix4, fade: number, tint: number): void {
    this.matrix.copy(source)
    this.matrix.elements[12] -= this.anchor.x
    this.matrix.elements[13] -= this.anchor.y
    this.matrix.elements[14] -= this.anchor.z
    const i = mesh.count++
    mesh.setMatrixAt(i, this.matrix)
    mesh.geometry.getAttribute('boulderState').setXY(i, fade, tint)
  }

  public hide(): void {
    this.shadows?.hide()
    this.group.visible = false
    this.count = 0
    this.obstacles.spheres = []
    this.cache.clear()
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.hide()
    this.shadows?.dispose()
    this.unregister()
    this.group.removeFromParent()
    for (const mesh of [...this.meshes, this.contacts]) {
      mesh.dispose()
      mesh.geometry.dispose()
    }
    this.material.dispose()
    ;(this.contacts.material as ShaderMaterial).dispose()
  }
}
