import {
  BufferAttribute,
  BufferGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  Points
} from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { BillboardAsteroidMaterial } from './BillboardAsteroidMaterial'
import { PointAsteroidMaterial } from './PointAsteroidMaterial'

/** Уровень детализации */
const enum LODLevel {
  /** Реальная геометрия (IcosahedronGeometry) */
  Geometry = 0,
  /** Billboard-импосторы (PlaneGeometry, camera-facing) */
  Billboard = 1,
  /** GPU Points (GL_POINTS с size attenuation) */
  PointCloud = 2
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
 * - L0: InstancedMesh с реальной геометрией
 * - L1: InstancedMesh с PlaneGeometry (billboard)
 * - L2: Points с custom attributes
 *
 * Каждый объект имеет pre-allocated буфер. Секторы аллоцируют диапазоны в буфере.
 * Свободное пространство управляется через free-list аллокатор.
 *
 * Итог: минимум draw calls (3 штуки на всю систему).
 */
class InstancePool {
  /** Рендер-объект для L0 */
  public geometryMesh: InstancedMesh
  /** Рендер-объект для L1 */
  public billboardMesh: InstancedMesh
  /** Рендер-объект для L2 */
  public pointsObject: Points

  /** Матрица нулевого масштаба для "скрытия" освобождённых экземпляров */
  private static readonly ZERO_MATRIX = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -99999, 1])

  /** Free-list для каждого LOD */
  private freeLists: Map<LODLevel, FreeRange[]> = new Map()

  /** Текущий максимальный занятый индекс для каждого LOD (определяет .count) */
  private highWaterMark: Map<LODLevel, number> = new Map()

  /** Конфиги уровней */
  private layerConfigs: Map<LODLevel, PoolLayerConfig>

  /** Материалы (хранятся для доступа к uniforms) */
  public billboardMaterial: BillboardAsteroidMaterial
  public pointsMaterial: PointAsteroidMaterial

  /** Dirty-флаги для отложенного commit */
  private dirtyLevels: Set<LODLevel> = new Set()

  public constructor(
    l0Config: PoolLayerConfig,
    l1Config: PoolLayerConfig,
    l2Config: PoolLayerConfig,
    asteroidGeometrySize: number
  ) {
    this.layerConfigs = new Map([
      [LODLevel.Geometry, l0Config],
      [LODLevel.Billboard, l1Config],
      [LODLevel.PointCloud, l2Config]
    ])

    // Инициализация free-lists
    this.freeLists.set(LODLevel.Geometry, [{ offset: 0, count: l0Config.maxInstances }])
    this.freeLists.set(LODLevel.Billboard, [{ offset: 0, count: l1Config.maxInstances }])
    this.freeLists.set(LODLevel.PointCloud, [{ offset: 0, count: l2Config.maxInstances }])

    this.highWaterMark.set(LODLevel.Geometry, 0)
    this.highWaterMark.set(LODLevel.Billboard, 0)
    this.highWaterMark.set(LODLevel.PointCloud, 0)

    // --- L0: Geometry InstancedMesh ---
    const l0Geometry = new IcosahedronGeometry(asteroidGeometrySize, 1)
    this.geometryMesh = new InstancedMesh(l0Geometry, new InstancedAsteroidMaterial(), l0Config.maxInstances)
    this.geometryMesh.count = 0
    this.geometryMesh.frustumCulled = false // Мы сами управляем видимостью
    this.geometryMesh.name = 'AsteroidPool_L0'

    // --- L1: Billboard InstancedMesh ---
    const l1Geometry = new PlaneGeometry(asteroidGeometrySize * 2.5, asteroidGeometrySize * 2.5)
    this.billboardMaterial = new BillboardAsteroidMaterial()
    this.billboardMesh = new InstancedMesh(l1Geometry, this.billboardMaterial, l1Config.maxInstances)
    this.billboardMesh.count = 0
    this.billboardMesh.frustumCulled = false
    this.billboardMesh.name = 'AsteroidPool_L1'

    // --- L2: Points ---
    this.pointsMaterial = new PointAsteroidMaterial()
    const l2Geometry = new BufferGeometry()
    const positionBuf = new Float32Array(l2Config.maxInstances * 3)
    const sizeBuf = new Float32Array(l2Config.maxInstances)
    l2Geometry.setAttribute('position', new BufferAttribute(positionBuf, 3))
    l2Geometry.setAttribute('aSize', new BufferAttribute(sizeBuf, 1))
    // Инициализируем drawRange
    l2Geometry.setDrawRange(0, 0)
    this.pointsObject = new Points(l2Geometry, this.pointsMaterial)
    this.pointsObject.frustumCulled = false
    this.pointsObject.name = 'AsteroidPool_L2'
  }

  /**
   * Аллоцировать диапазон в буфере для сектора.
   * @returns Allocation или null если нет свободного места.
   */
  public allocate(lodLevel: LODLevel, count: number): Allocation | null {
    const freeList = this.freeLists.get(lodLevel)!
    // First-fit поиск
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

        // Обновить high water mark
        const hwm = this.highWaterMark.get(lodLevel)!
        const newEnd = offset + count
        if (newEnd > hwm) {
          this.highWaterMark.set(lodLevel, newEnd)
        }

        return { lodLevel, offset, count }
      }
    }

    return null // Нет места
  }

  /**
   * Освободить ранее аллоцированный диапазон.
   * Скрывает экземпляры (zero-scale matrix) и возвращает в free-list.
   */
  public release(allocation: Allocation): void {
    const { lodLevel, offset, count } = allocation

    // Скрыть экземпляры
    if (lodLevel === LODLevel.PointCloud) {
      this.clearPoints(offset, count)
    } else {
      this.clearInstances(lodLevel, offset, count)
    }

    // Вернуть в free-list
    const freeList = this.freeLists.get(lodLevel)!
    freeList.push({ offset, count })
    // Сортировка и merge
    this.defragFreeList(freeList)

    // Пересчитать high water mark
    this.recalcHighWaterMark(lodLevel)

    this.dirtyLevels.add(lodLevel)
  }

  /**
   * Записать матрицы экземпляров в буфер (для L0 и L1).
   */
  public writeMatrices(lodLevel: LODLevel, offset: number, matrices: Float32Array): void {
    const mesh = lodLevel === LODLevel.Geometry ? this.geometryMesh : this.billboardMesh
    const dst = mesh.instanceMatrix.array as Float32Array
    dst.set(matrices, offset * 16)
    this.dirtyLevels.add(lodLevel)
  }

  /**
   * Записать позиции и размеры для Points (L2).
   * @param offset
   * @param data — Float32Array длиной count * 4 (x, y, z, size)
   */
  public writePoints(offset: number, data: Float32Array): void {
    const geom = this.pointsObject.geometry
    const posArr = (geom.getAttribute('position') as BufferAttribute).array as Float32Array
    const sizeArr = (geom.getAttribute('aSize') as BufferAttribute).array as Float32Array

    const count = data.length / 4
    for (let i = 0; i < count; i++) {
      const srcIdx = i * 4
      const dstPosIdx = (offset + i) * 3
      posArr[dstPosIdx] = data[srcIdx]
      posArr[dstPosIdx + 1] = data[srcIdx + 1]
      posArr[dstPosIdx + 2] = data[srcIdx + 2]
      sizeArr[offset + i] = data[srcIdx + 3]
    }

    this.dirtyLevels.add(LODLevel.PointCloud)
  }

  /**
   * Применить все накопленные изменения к GPU-буферам.
   * Вызывать один раз в конце кадра.
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

    if (this.dirtyLevels.has(LODLevel.PointCloud)) {
      const geom = this.pointsObject.geometry
      const hwm = this.highWaterMark.get(LODLevel.PointCloud)!
      ;(geom.getAttribute('position') as BufferAttribute).needsUpdate = true
      ;(geom.getAttribute('aSize') as BufferAttribute).needsUpdate = true
      geom.setDrawRange(0, hwm)
    }

    this.dirtyLevels.clear()
  }

  /**
   * Получить все рендер-объекты для добавления в сцену.
   */
  public getRenderObjects(): Object3D[] {
    return [this.geometryMesh, this.billboardMesh, this.pointsObject]
  }

  /**
   * Получить общее количество active instances по всем уровням.
   */
  public getActiveCount(): { l0: number; l1: number; l2: number; total: number } {
    const l0 = this.highWaterMark.get(LODLevel.Geometry)!
    const l1 = this.highWaterMark.get(LODLevel.Billboard)!
    const l2 = this.highWaterMark.get(LODLevel.PointCloud)!
    return { l0, l1, l2, total: l0 + l1 + l2 }
  }

  // === Private ===

  private clearInstances(lodLevel: LODLevel, offset: number, count: number): void {
    const mesh = lodLevel === LODLevel.Geometry ? this.geometryMesh : this.billboardMesh
    const dst = mesh.instanceMatrix.array as Float32Array
    for (let i = 0; i < count; i++) {
      dst.set(InstancePool.ZERO_MATRIX, (offset + i) * 16)
    }
  }

  private clearPoints(offset: number, count: number): void {
    const geom = this.pointsObject.geometry
    const posArr = (geom.getAttribute('position') as BufferAttribute).array as Float32Array
    const sizeArr = (geom.getAttribute('aSize') as BufferAttribute).array as Float32Array
    for (let i = 0; i < count; i++) {
      const idx = (offset + i) * 3
      posArr[idx] = 0
      posArr[idx + 1] = -99999
      posArr[idx + 2] = 0
      sizeArr[offset + i] = 0
    }
  }

  private defragFreeList(freeList: FreeRange[]): void {
    // Сортировка по offset
    freeList.sort((a, b) => a.offset - b.offset)

    // Merge смежных диапазонов
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
      // Всё занято
      this.highWaterMark.set(lodLevel, maxInstances)
      return
    }

    // Последний свободный диапазон
    const lastFree = freeList[freeList.length - 1]
    if (lastFree.offset + lastFree.count === maxInstances) {
      // Последний свободный блок доходит до конца — hwm = начало этого блока
      this.highWaterMark.set(lodLevel, lastFree.offset)
    } else {
      // Есть занятые элементы после последнего свободного
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
    this.pointsObject.geometry.setDrawRange(0, 0)

    this.dirtyLevels.clear()
  }
}

export { InstancePool, LODLevel }
export type { Allocation, PoolLayerConfig }
