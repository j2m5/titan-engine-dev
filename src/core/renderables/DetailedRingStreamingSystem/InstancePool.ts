import { IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Object3D, PlaneGeometry } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { BillboardAsteroidMaterial } from './BillboardAsteroidMaterial'

/** Уровень детализации */
const enum LODLevel {
  /** Реальная геометрия (IcosahedronGeometry), обычный detail */
  Geometry = 0,
  /** Billboard-импосторы (PlaneGeometry, camera-facing) */
  Billboard = 1,
  /** Реальная геометрия повышенного detail для самых близких камней */
  GeometryNear = 2
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
 * Владеет тремя рендер-объектами (по одному на LOD):
 * - L0 Near: InstancedMesh с реальной геометрией повышенного detail (ближние камни)
 * - L0: InstancedMesh с реальной геометрией обычного detail
 * - L1: InstancedMesh с PlaneGeometry (billboard)
 *
 * Оба геометрических тира разделяют один материал (различие — только detail
 * геометрии), поэтому проводка юниформов идёт по geometryMesh.material и
 * автоматически применяется к ближнему тиру.
 *
 * Каждый объект имеет pre-allocated буфер. Секторы аллоцируют диапазоны в буфере.
 * Свободное пространство управляется через free-list аллокатор.
 *
 * Итог: 3 draw calls на всю систему экземпляров.
 */
class InstancePool {
  /** Рендер-объект для L0 (обычный detail) */
  public geometryMesh: InstancedMesh
  /** Рендер-объект для ближнего L0 (повышенный detail) */
  public geometryNearMesh: InstancedMesh
  /** Рендер-объект для L1 */
  public billboardMesh: InstancedMesh

  /** LOD → InstancedMesh (единая точка выбора меша по уровню) */
  private readonly meshes: Map<LODLevel, InstancedMesh> = new Map()

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

  /** Dirty-флаги для отложенного commit матриц */
  private dirtyLevels: Set<LODLevel> = new Set()

  /** Dirty-флаги для отложенного commit fade-атрибута (меняется каждый кадр перехода) */
  private dirtyFadeLevels: Set<LODLevel> = new Set()

  public constructor(
    l0Config: PoolLayerConfig,
    l1Config: PoolLayerConfig,
    asteroidGeometrySize: number,
    l0Detail: number = 1,
    l0NearConfig: PoolLayerConfig = l0Config,
    l0NearDetail: number = 3
  ) {
    this.layerConfigs = new Map([
      [LODLevel.Geometry, l0Config],
      [LODLevel.Billboard, l1Config],
      [LODLevel.GeometryNear, l0NearConfig]
    ])

    // Инициализация free-lists + highWaterMark для всех уровней
    for (const [level, config] of this.layerConfigs) {
      this.freeLists.set(level, [{ offset: 0, count: config.maxInstances }])
      this.highWaterMark.set(level, 0)
    }

    // --- L0: Geometry InstancedMesh ---
    // detail управляет неровностью силуэта после GPU-деформации (см. AsteroidShape).
    const l0Geometry = new IcosahedronGeometry(asteroidGeometrySize, l0Detail)
    this.geometryMesh = new InstancedMesh(l0Geometry, new InstancedAsteroidMaterial(), l0Config.maxInstances)
    this.geometryMesh.count = 0
    this.geometryMesh.frustumCulled = false
    this.geometryMesh.name = 'AsteroidPool_L0'

    // Per-instance fade [0..1] для плавных LOD/sector-переходов (см. writeFade).
    // Инициализирован нулями: слот невидим, пока сектор не проявится.
    l0Geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(l0Config.maxInstances), 1))

    // --- L0 Near: тот же материал, выше detail (гладкий силуэт/бассейны вблизи) ---
    // Разделяем материал с обычным L0 → проводка юниформов остаётся единой.
    const l0NearGeometry = new IcosahedronGeometry(asteroidGeometrySize, l0NearDetail)
    this.geometryNearMesh = new InstancedMesh(l0NearGeometry, this.geometryMesh.material, l0NearConfig.maxInstances)
    this.geometryNearMesh.count = 0
    this.geometryNearMesh.frustumCulled = false
    this.geometryNearMesh.name = 'AsteroidPool_L0Near'
    l0NearGeometry.setAttribute(
      'instanceFade',
      new InstancedBufferAttribute(new Float32Array(l0NearConfig.maxInstances), 1)
    )

    // --- L1: Billboard InstancedMesh ---
    const l1Geometry = new PlaneGeometry(asteroidGeometrySize * 2.5, asteroidGeometrySize * 2.5)
    this.billboardMaterial = new BillboardAsteroidMaterial()
    this.billboardMesh = new InstancedMesh(l1Geometry, this.billboardMaterial, l1Config.maxInstances)
    this.billboardMesh.count = 0
    this.billboardMesh.frustumCulled = false
    this.billboardMesh.name = 'AsteroidPool_L1'

    l1Geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(l1Config.maxInstances), 1))

    this.meshes.set(LODLevel.Geometry, this.geometryMesh)
    this.meshes.set(LODLevel.GeometryNear, this.geometryNearMesh)
    this.meshes.set(LODLevel.Billboard, this.billboardMesh)
  }

  /** InstancedMesh для заданного LOD. */
  private meshFor(lodLevel: LODLevel): InstancedMesh {
    return this.meshes.get(lodLevel)!
  }

  /** InstancedBufferAttribute fade для заданного LOD. */
  private fadeAttribute(lodLevel: LODLevel): InstancedBufferAttribute {
    return this.meshFor(lodLevel).geometry.getAttribute('instanceFade') as InstancedBufferAttribute
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
    const dst = this.meshFor(lodLevel).instanceMatrix.array as Float32Array
    dst.set(matrices, offset * 16)
    this.dirtyLevels.add(lodLevel)
  }

  /**
   * Записать per-instance fade [0..1] в диапазон [offset, offset+count).
   * Значение общее для всего сектора; меняется покадрово во время перехода.
   */
  public writeFade(lodLevel: LODLevel, offset: number, count: number, fade: number): void {
    const attr = this.fadeAttribute(lodLevel)
    const dst = attr.array as Float32Array
    dst.fill(fade, offset, offset + count)
    this.dirtyFadeLevels.add(lodLevel)
  }

  /**
   * Применить все накопленные изменения к GPU-буферам.
   */
  public commitUpdates(): void {
    for (const level of this.dirtyLevels) {
      const mesh = this.meshFor(level)
      mesh.instanceMatrix.needsUpdate = true
      mesh.count = this.highWaterMark.get(level)!
    }

    for (const level of this.dirtyFadeLevels) {
      this.fadeAttribute(level).needsUpdate = true
    }

    this.dirtyLevels.clear()
    this.dirtyFadeLevels.clear()
  }

  /**
   * Получить все рендер-объекты для добавления в сцену.
   */
  public getRenderObjects(): Object3D[] {
    return [this.geometryMesh, this.geometryNearMesh, this.billboardMesh]
  }

  /**
   * Получить общее количество active instances по всем уровням.
   * Ближний тир входит в счётчик L0 (это та же геометрия L0, выше detail).
   */
  public getActiveCount(): { l0: number; l1: number; total: number } {
    const l0 = this.highWaterMark.get(LODLevel.Geometry)! + this.highWaterMark.get(LODLevel.GeometryNear)!
    const l1 = this.highWaterMark.get(LODLevel.Billboard)!
    return { l0, l1, total: l0 + l1 }
  }

  // === Private ===

  private clearInstances(lodLevel: LODLevel, offset: number, count: number): void {
    const mesh = this.meshFor(lodLevel)
    const dst = mesh.instanceMatrix.array as Float32Array
    for (let i = 0; i < count; i++) {
      dst.set(InstancePool.ZERO_MATRIX, (offset + i) * 16)
    }

    // Обнулить fade освобождённого диапазона — чтобы переиспользуемый слот не
    // унаследовал остаточную видимость до первой записи менеджером.
    const fade = this.fadeAttribute(lodLevel).array as Float32Array
    fade.fill(0, offset, offset + count)
    this.dirtyFadeLevels.add(lodLevel)
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
    this.geometryNearMesh.count = 0
    this.billboardMesh.count = 0
    this.dirtyLevels.clear()
    this.dirtyFadeLevels.clear()
  }
}

export { InstancePool, LODLevel }
export type { Allocation, PoolLayerConfig }
