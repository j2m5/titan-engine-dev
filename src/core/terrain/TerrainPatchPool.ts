import { BufferAttribute, BufferGeometry, Mesh } from 'three'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { buildPatchIndex } from './terrainPatchGeometry'

/**
 * Потолок одновременно живых патчей квадродерева. Задача 5 держит рабочий
 * набор узлов SSE-отбора заметно ниже этого числа на разумных экранах —
 * потолок страхует от неограниченного роста при патологическом отборе
 * (камера в стене, дребезг), а не отражает штатный размер набора.
 */
export const MAX_LIVE_PATCHES = 640

export type PatchHandle = { mesh: Mesh; geometry: BufferGeometry }

const GRID_VERTEX_COUNT = (segments: number): number => (segments + 1) * (segments + 1)
const RING_COUNT = (segments: number): number => 4 * segments

/**
 * Пул патчей квадродерева: split/merge переиспользует геометрии слотов без
 * аллокаций типизированных массивов и BufferGeometry — buildTerrainPatchInto
 * перезаписывает атрибуты на месте (см. terrainPatchGeometry). Один общий
 * index-атрибут на все геометрии пула (та же экономия, что у TerrainSphere
 * этапа 3а). Свободные слоты держат геометрию живой между acquire —
 * освобождаются вместе с индексом только в dispose.
 */
class TerrainPatchPool {
  private readonly material: PlanetMaterial
  private readonly segments: number
  private readonly index: BufferAttribute
  private readonly free: PatchHandle[] = []
  private live = 0

  public constructor(material: PlanetMaterial, segments: number) {
    this.material = material
    this.segments = segments
    this.index = buildPatchIndex(segments)
  }

  public get liveCount(): number {
    return this.live
  }

  public acquire(): PatchHandle | null {
    if (this.live >= MAX_LIVE_PATCHES) return null

    const handle = this.free.pop() ?? this.createHandle()
    this.live++

    return handle
  }

  public release(handle: PatchHandle): void {
    this.free.push(handle)
    this.live--
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
    const vertexCount = GRID_VERTEX_COUNT(this.segments) + RING_COUNT(this.segments)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertexCount * 3), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(vertexCount * 3), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(vertexCount * 2), 2))
    geometry.setIndex(this.index)

    const mesh = new Mesh(geometry, this.material)
    mesh.userData.clickable = true
    mesh.frustumCulled = true

    return { mesh, geometry }
  }
}

export { TerrainPatchPool }
