import { IcosahedronGeometry, InstancedMesh, Object3D, PlaneGeometry } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { BillboardAsteroidMaterial } from './BillboardAsteroidMaterial'

/** Уровень детализации */
const enum LODLevel {
  /** Реальная геометрия (IcosahedronGeometry) */
  Geometry = 0,
  /** Billboard-импосторы (PlaneGeometry, camera-facing) */
  Billboard = 1
}

/** Результат аллокации */
interface Allocation {
  lodLevel: LODLevel
  offset: number
  count: number
}

/** Диапазон свободного пространства в буфере */
interface FreeRange {
  offset: number
  count: number
}

/** Конфигурация пула для одного LOD-уровня */
interface PoolLayerConfig {
  maxInstances: number
}

/**
 * InstancePool — управление GPU-ресурсами.
 *
 * Владеет двумя рендер-объектами (по одному на LOD):
 * - L0: InstancedMesh с реальной геометрией
 * - L1: InstancedMesh с PlaneGeometry (billboard)
 *
 * Каждый объект имеет pre-allocated буфер. Секторы аллоцируют диапазоны в буфере.
 * Свободное пространство управляется через free-list аллокатор.
 *
 * Итог: 2 draw calls на всю систему экземпляров.
 */
class InstancePool {
  /** Рендер-объект для L0 */
  public geometryMesh: InstancedMesh
  /** Рендер-объект для L1 */
  public billboardMesh: InstancedMesh

  /** Матрица нулевого масштаба для "скрытия" освобождённых экземпляров */
  private static readonly ZERO_MATRIX = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -99999, 1])

  /** Free-list для каждого LOD */
  private freeLists: Map<LODLevel, FreeRange[]> = new Map()

  /** Текущий максимальный занятый индекс для каждого LOD (определяет .count) */
  private highWaterMark: Map<LODLevel, number> = new Map()

  /** Конфиги уровней */
  private readonly layerConfigs: Map<LODLevel, PoolLayerConfig>

  /** Материал billboard (хранится для доступа к uniforms) */
  public billboardMaterial: BillboardAsteroidMaterial

  /** Dirty-флаги для отложенного commit */
  private dirtyLevels: Set<LODLevel> = new Set()

  public constructor(l0Config: PoolLayerConfig, l1Config: PoolLayerConfig, asteroidGeometrySize: number) {
    this.layerConfigs = new Map([
      [LODLevel.Geometry, l0Config],
      [LODLevel.Billboard, l1Config]
    ])

    // Инициализация free-lists
    this.freeLists.set(LODLevel.Geometry, [{ offset: 0, count: l0Config.maxInstances }])
    this.freeLists.set(LODLevel.Billboard, [{ offset: 0, count: l1Config.maxInstances }])

    this.highWaterMark.set(LODLevel.Geometry, 0)
    this.highWaterMark.set(LODLevel.Billboard, 0)

    // --- L0: Geometry InstancedMesh ---
    const l0Geometry = new IcosahedronGeometry(asteroidGeometrySize, 1)
    this.geometryMesh = new InstancedMesh(l0Geometry, new InstancedAsteroidMaterial(), l0Config.maxInstances)
    this.geometryMesh.count = 0
    this.geometryMesh.frustumCulled = false
    this.geometryMesh.name = 'AsteroidPool_L0'

    // --- L1: Billboard InstancedMesh ---
    const l1Geometry = new PlaneGeometry(asteroidGeometrySize * 2.5, asteroidGeometrySize * 2.5)
    this.billboardMaterial = new BillboardAsteroidMaterial()
    this.billboardMesh = new InstancedMesh(l1Geometry, this.billboardMaterial, l1Config.maxInstances)
    this.billboardMesh.count = 0
    this.billboardMesh.frustumCulled = false
    this.billboardMesh.name = 'AsteroidPool_L1'
  }

  /**
   * Аллоцировать диапазон в буфере для сектора.
   * @returns Allocation или null если нет свободного места.
   */
  public allocate(lodLevel: LODLevel, count: number): Allocation | null {
    const freeList = this.freeLists.get(lodLevel)!

    for (let i = 0; i < freeList.length; i++) {
      const range = freeList[i]
      if (range.count >= count) {
        const offset = range.offset

        if (range.count === count) {
          freeList.splice(i, 1)
        } else {
          range.offset += count
          range.count -= count
        }

        const hwm = this.highWaterMark.get(lodLevel)!
        const newEnd = offset + count
        if (newEnd > hwm) {
          this.highWaterMark.set(lodLevel, newEnd)
        }

        return { lodLevel, offset, count }
      }
    }

    return null
  }

  /**
   * Освободить ранее аллоцированный диапазон.
   */
  public release(allocation: Allocation): void {
    const { lodLevel, offset, count } = allocation

    this.clearInstances(lodLevel, offset, count)

    const freeList = this.freeLists.get(lodLevel)!
    freeList.push({ offset, count })
    this.defragFreeList(freeList)
    this.recalcHighWaterMark(lodLevel)
    this.dirtyLevels.add(lodLevel)
  }

  /**
   * Записать матрицы экземпляров в буфер.
   */
  public writeMatrices(lodLevel: LODLevel, offset: number, matrices: Float32Array): void {
    const mesh = lodLevel === LODLevel.Geometry ? this.geometryMesh : this.billboardMesh
    const dst = mesh.instanceMatrix.array as Float32Array
    dst.set(matrices, offset * 16)
    this.dirtyLevels.add(lodLevel)
  }

  /**
   * Применить все накопленные изменения к GPU-буферам.
   */
  public commitUpdates(): void {
    if (this.dirtyLevels.has(LODLevel.Geometry)) {
      this.geometryMesh.instanceMatrix.needsUpdate = true
      this.geometryMesh.count = this.highWaterMark.get(LODLevel.Geometry)!
    }

    if (this.dirtyLevels.has(LODLevel.Billboard)) {
      this.billboardMesh.instanceMatrix.needsUpdate = true
      this.billboardMesh.count = this.highWaterMark.get(LODLevel.Billboard)!
    }

    this.dirtyLevels.clear()
  }

  /**
   * Получить все рендер-объекты для добавления в сцену.
   */
  public getRenderObjects(): Object3D[] {
    return [this.geometryMesh, this.billboardMesh]
  }

  /**
   * Получить общее количество active instances по всем уровням.
   */
  public getActiveCount(): { l0: number; l1: number; total: number } {
    const l0 = this.highWaterMark.get(LODLevel.Geometry)!
    const l1 = this.highWaterMark.get(LODLevel.Billboard)!
    return { l0, l1, total: l0 + l1 }
  }

  // === Private ===

  private clearInstances(lodLevel: LODLevel, offset: number, count: number): void {
    const mesh = lodLevel === LODLevel.Geometry ? this.geometryMesh : this.billboardMesh
    const dst = mesh.instanceMatrix.array as Float32Array
    for (let i = 0; i < count; i++) {
      dst.set(InstancePool.ZERO_MATRIX, (offset + i) * 16)
    }
  }

  private defragFreeList(freeList: FreeRange[]): void {
    freeList.sort((a, b) => a.offset - b.offset)

    let i = 0
    while (i < freeList.length - 1) {
      const current = freeList[i]
      const next = freeList[i + 1]
      if (current.offset + current.count === next.offset) {
        current.count += next.count
        freeList.splice(i + 1, 1)
      } else {
        i++
      }
    }
  }

  private recalcHighWaterMark(lodLevel: LODLevel): void {
    const maxInstances = this.layerConfigs.get(lodLevel)!.maxInstances
    const freeList = this.freeLists.get(lodLevel)!

    if (freeList.length === 0) {
      this.highWaterMark.set(lodLevel, maxInstances)
      return
    }

    const lastFree = freeList[freeList.length - 1]
    if (lastFree.offset + lastFree.count === maxInstances) {
      this.highWaterMark.set(lodLevel, lastFree.offset)
    } else {
      this.highWaterMark.set(lodLevel, maxInstances)
    }
  }

  /**
   * Полный сброс всех буферов и free-lists.
   */
  public reset(): void {
    for (const [level, config] of this.layerConfigs) {
      this.freeLists.set(level, [{ offset: 0, count: config.maxInstances }])
      this.highWaterMark.set(level, 0)
    }

    this.geometryMesh.count = 0
    this.billboardMesh.count = 0
    this.dirtyLevels.clear()
  }
}

export { InstancePool, LODLevel }
export type { Allocation, PoolLayerConfig }
