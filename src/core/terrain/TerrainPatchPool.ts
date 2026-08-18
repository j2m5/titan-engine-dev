import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Material, Mesh } from 'three'
import { buildPatchIndex, terrainPatchVertexCount } from './terrainPatchGeometry'

/**
 * Потолок одновременно живых патчей квадродерева. Замер: на HiDPI (H=2160)
 * при τ≈2 желаемый набор SSE-отбора уже 552+ листьев, а живых на переходах
 * split/merge больше (старый и новый узел видны одновременно, см. инвариант
 * «без дыр» в TerrainSphere) — 640 пробивается. 1024 слота = ~147 МБ
 * атрибутов при ленивой аллокации (createHandle зовётся по факту, не заранее)
 * — платит только дошедший до этой глубины набор. Потолок страхует от
 * неограниченного роста при патологическом отборе (камера в стене, дребезг),
 * не отражает штатный размер набора.
 */
export const MAX_LIVE_PATCHES = 1024

export type PatchHandle = { mesh: Mesh; geometry: BufferGeometry }

/**
 * Пул патчей квадродерева: split/merge переиспользует геометрии слотов без
 * аллокаций типизированных массивов и BufferGeometry — buildTerrainPatchInto
 * перезаписывает атрибуты на месте (см. terrainPatchGeometry). Один общий
 * index-атрибут на все геометрии пула (та же экономия, что у TerrainSphere
 * этапа 3а). Свободные слоты держат геометрию живой между acquire —
 * освобождаются вместе с индексом только в dispose.
 *
 * Материал типизирован общим `Material`, не `PlanetMaterial` — пул сам с
 * материалом не взаимодействует (только держит ссылку для `new Mesh`), а
 * TerrainPatchGroup (общая база TerrainSphere/WaterSphere) передаёт сюда
 * конкретный класс своего потребителя.
 */
class TerrainPatchPool {
  private readonly material: Material
  private readonly segments: number
  private readonly index: BufferAttribute
  private readonly free: PatchHandle[] = []
  private readonly occupied = new Set<PatchHandle>()

  public constructor(material: Material, segments: number) {
    this.material = material
    this.segments = segments
    this.index = buildPatchIndex(segments)
  }

  public get liveCount(): number {
    return this.occupied.size
  }

  public acquire(): PatchHandle | null {
    if (this.occupied.size >= MAX_LIVE_PATCHES) return null

    const handle = this.free.pop() ?? this.createHandle()
    this.occupied.add(handle)

    return handle
  }

  /**
   * Guard двойного release: handle не в occupied (уже освобождён либо чужой)
   * — тихий return. Инвариант дешёвый, но без него повторный release кладёт
   * один и тот же handle в free дважды, и следующие два acquire раздают его
   * двум живым мешам одновременно.
   */
  public release(handle: PatchHandle): void {
    if (!this.occupied.delete(handle)) return

    this.free.push(handle)
  }

  /**
   * Геометрии свободных слотов + общий индекс: BufferGeometry.dispose()
   * освобождает GPU-буфер geometry.index через WebGLAttributes — индекс
   * общий по ссылке у всех геометрий пула, поэтому первый вызов снимает
   * буфер за все, остальные — идемпотентны (см. тот же паттерн в
   * TerrainSphere). Живые слоты — на совести вызывающего: release перед dispose.
   */
  public dispose(): void {
    for (const handle of this.free) handle.geometry.dispose()
    this.free.length = 0
  }

  private createHandle(): PatchHandle {
    const vertexCount = terrainPatchVertexCount(this.segments)
    const geometry = new BufferGeometry()
    const position = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
    const normal = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
    const uv = new BufferAttribute(new Float32Array(vertexCount * 2), 2)
    // DynamicDrawUsage: split/merge перезаписывает эти атрибуты на месте
    // каждый раз, когда слот переиспользуется (buildTerrainPatchInto) — не
    // однократная запись, которую предполагает дефолтный StaticDrawUsage.
    position.setUsage(DynamicDrawUsage)
    normal.setUsage(DynamicDrawUsage)
    uv.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', position)
    geometry.setAttribute('normal', normal)
    geometry.setAttribute('uv', uv)
    geometry.setIndex(this.index)

    const mesh = new Mesh(geometry, this.material)
    mesh.userData.clickable = true
    mesh.frustumCulled = true

    return { mesh, geometry }
  }
}

export { TerrainPatchPool }
