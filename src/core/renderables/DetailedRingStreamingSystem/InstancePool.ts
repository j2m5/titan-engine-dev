import { type BufferGeometry, InstancedBufferAttribute, InstancedMesh, Object3D, PlaneGeometry } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { BillboardAsteroidMaterial } from './BillboardAsteroidMaterial'

/**
 * Уровень детализации — используется МЕНЕДЖЕРОМ для решений (какой стрим
 * Geometry/Billboard адресовать), пул больше не хранит состояние по LOD:
 * адресация внутри пула — стримами (см. Allocation.stream).
 */
const enum LODLevel {
  /** Реальная геометрия (запечённый архетип), обычный detail */
  Geometry = 0,
  /** Billboard-импосторы (PlaneGeometry, camera-facing) */
  Billboard = 1
}

/** Результат аллокации. stream: 0..K-1 = архетипы Geometry, K = billboard. */
interface Allocation {
  stream: number
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

/** Внутреннее состояние одного инстанс-стрима (Geometry-архетип или billboard) */
interface Stream {
  mesh: InstancedMesh
  freeList: FreeRange[]
  /** Текущий максимальный занятый индекс (определяет .count меша) */
  hwm: number
  /** Счётчик отказов allocate() — диагностика исчерпания стрима */
  failures: number
  capacity: number
}

/**
 * InstancePool — управление GPU-ресурсами.
 *
 * Владеет K+1 рендер-объектами:
 * - K стримов Geometry (0..K-1): по одному InstancedMesh на архетип, ВСЕ делят
 *   один InstancedAsteroidMaterial (K архетипов = K геометрий, но не K
 *   материалов — иначе драуколлов было бы 2K вместо K+1).
 * - 1 стрим Billboard (индекс K): InstancedMesh с PlaneGeometry (camera-facing).
 *
 * Каждый стрим имеет pre-allocated буфер. Секторы аллоцируют диапазоны в
 * буфере нужного стрима. Свободное пространство управляется через free-list
 * аллокатор — независимо по каждому стриму.
 *
 * Итог: K+1 draw calls на всю систему экземпляров.
 */
class InstancePool {
  /** Geometry-меши, по одному на архетип (стримы 0..K-1) */
  public readonly geometryMeshes: InstancedMesh[]
  /** Материал, общий для ВСЕХ Geometry-мешей (один инстанс на K архетипов) */
  public readonly geometryMaterial: InstancedAsteroidMaterial
  /** Рендер-объект для billboard-стрима (индекс K) */
  public billboardMesh: InstancedMesh
  /** Материал billboard (хранится для доступа к uniforms) */
  public billboardMaterial: BillboardAsteroidMaterial

  /** Матрица нулевого масштаба для "скрытия" освобождённых экземпляров */
  private static readonly ZERO_MATRIX = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -99999, 1])

  /**
   * Стримы: индексы 0..K-1 — Geometry-архетипы, индекс K (== billboardStream)
   * — billboard. Единая адресация вместо Map<LODLevel,...>.
   */
  private readonly streams: Stream[]

  /** Dirty-флаги для отложенного commit матриц, по стримам */
  private dirtyStreams: Set<number> = new Set()

  /** Dirty-флаги для отложенного commit fade-атрибута, по стримам */
  private dirtyFadeStreams: Set<number> = new Set()

  /**
   * @param l0Geometries K готовых геометрий Geometry-архетипов (запечённые
   *   архетипы или, временно, IcosahedronGeometry — см. вызывающий код). Пул
   *   не строит геометрию сам: он отвечает только за инстансинг и аллокации,
   *   форму астероидов несёт вызывающая сторона. K = l0Geometries.length.
   * @param billboardSize Сторона PlaneGeometry для billboard-стрима.
   */
  public constructor(
    l0Config: PoolLayerConfig,
    l1Config: PoolLayerConfig,
    l0Geometries: BufferGeometry[],
    billboardSize: number
  ) {
    const streamCount = l0Geometries.length
    // Ёмкость КАЖДОГО Geometry-стрима больше "справедливой" доли maxInstances/K:
    // страховка от локальной фрагментации (сектор с архетипом-меньшинством не
    // должен упираться в потолок раньше, чем исчерпан суммарный бюджет).
    const streamCapacity = Math.ceil((l0Config.maxInstances / streamCount) * 1.5)

    this.geometryMaterial = new InstancedAsteroidMaterial()
    this.geometryMeshes = []
    this.streams = []

    for (let k = 0; k < streamCount; k++) {
      const geometry = l0Geometries[k]
      const mesh = new InstancedMesh(geometry, this.geometryMaterial, streamCapacity)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.name = `AsteroidPool_L0_${k}`

      // Per-instance fade [0..1] для плавных LOD/sector-переходов (см. writeFade).
      // Каждая геометрия — отдельный объект → атрибут вешается на СВОЮ геометрию.
      geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(streamCapacity), 1))

      this.geometryMeshes.push(mesh)
      this.streams.push({
        mesh,
        freeList: [{ offset: 0, count: streamCapacity }],
        hwm: 0,
        failures: 0,
        capacity: streamCapacity
      })
    }

    // --- Billboard-стрим (индекс streamCount) ---
    const l1Geometry = new PlaneGeometry(billboardSize, billboardSize)
    this.billboardMaterial = new BillboardAsteroidMaterial()
    this.billboardMesh = new InstancedMesh(l1Geometry, this.billboardMaterial, l1Config.maxInstances)
    this.billboardMesh.count = 0
    this.billboardMesh.frustumCulled = false
    this.billboardMesh.name = 'AsteroidPool_L1'

    l1Geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(l1Config.maxInstances), 1))

    this.streams.push({
      mesh: this.billboardMesh,
      freeList: [{ offset: 0, count: l1Config.maxInstances }],
      hwm: 0,
      failures: 0,
      capacity: l1Config.maxInstances
    })
  }

  /** Количество Geometry-стримов (K архетипов). */
  public get geometryStreamCount(): number {
    return this.geometryMeshes.length
  }

  /** Индекс billboard-стрима (== K). */
  public get billboardStream(): number {
    return this.geometryMeshes.length
  }

  /** InstancedBufferAttribute fade для заданного стрима. */
  private fadeAttribute(stream: number): InstancedBufferAttribute {
    return this.streams[stream].mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute
  }

  /**
   * Аллоцировать диапазон в буфере стрима для сектора.
   * @returns Allocation или null если нет свободного места.
   */
  public allocate(stream: number, count: number): Allocation | null {
    const s = this.streams[stream]
    const freeList = s.freeList

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

        const newEnd = offset + count
        if (newEnd > s.hwm) {
          s.hwm = newEnd
        }

        return { stream, offset, count }
      }
    }

    s.failures++
    return null
  }

  /**
   * Освободить ранее аллоцированный диапазон.
   */
  public release(allocation: Allocation): void {
    const { stream, offset, count } = allocation

    this.clearInstances(stream, offset, count)

    const s = this.streams[stream]
    s.freeList.push({ offset, count })
    this.defragFreeList(s.freeList)
    this.recalcHighWaterMark(stream)
    this.dirtyStreams.add(stream)
  }

  /**
   * Записать матрицы экземпляров в буфер стрима.
   */
  public writeMatrices(stream: number, offset: number, matrices: Float32Array): void {
    const dst = this.streams[stream].mesh.instanceMatrix.array as Float32Array
    dst.set(matrices, offset * 16)
    this.dirtyStreams.add(stream)
  }

  /**
   * Записать per-instance fade [0..1] в диапазон [offset, offset+count) стрима.
   * Значение общее для всего сектора; меняется покадрово во время перехода.
   */
  public writeFade(stream: number, offset: number, count: number, fade: number): void {
    const attr = this.fadeAttribute(stream)
    const dst = attr.array as Float32Array
    dst.fill(fade, offset, offset + count)
    this.dirtyFadeStreams.add(stream)
  }

  /**
   * Применить все накопленные изменения к GPU-буферам.
   */
  public commitUpdates(): void {
    for (const stream of this.dirtyStreams) {
      const s = this.streams[stream]
      s.mesh.instanceMatrix.needsUpdate = true
      s.mesh.count = s.hwm
    }

    for (const stream of this.dirtyFadeStreams) {
      this.fadeAttribute(stream).needsUpdate = true
    }

    this.dirtyStreams.clear()
    this.dirtyFadeStreams.clear()
  }

  /**
   * Получить все рендер-объекты для добавления в сцену (K+1: K Geometry + 1 billboard).
   */
  public getRenderObjects(): Object3D[] {
    return [...this.geometryMeshes, this.billboardMesh]
  }

  /**
   * Получить общее количество active instances по всем уровням.
   * l0 — сумма high-water mark всех Geometry-стримов (внешняя форма не меняется).
   */
  public getActiveCount(): { l0: number; l1: number; total: number } {
    let l0 = 0
    for (let i = 0; i < this.geometryStreamCount; i++) {
      l0 += this.streams[i].hwm
    }
    const l1 = this.streams[this.billboardStream].hwm
    return { l0, l1, total: l0 + l1 }
  }

  /** Занятость и отказы одного стрима (диагностика переполнения) */
  private streamPressure(stream: number): { used: number; capacity: number; failures: number } {
    const s = this.streams[stream]
    const free = s.freeList.reduce((sum, range) => sum + range.count, 0)
    return { used: s.capacity - free, capacity: s.capacity, failures: s.failures }
  }

  /**
   * Диагностика давления на пулы: фактическая занятость (не high-water mark)
   * и накопленные отказы allocate(). Ненулевые failures = сектора молча
   * пропадали из рендера — пора поднимать maxInstances или снижать density.
   *
   * ВНЕШНЯЯ ФОРМА НЕ МЕНЯЕТСЯ: l0 — СУММА used/capacity/failures по всем K
   * Geometry-стримам (потребители — getDebugInfo/__warnOnPoolExhaustion —
   * остаются без правок).
   */
  public getPressureInfo(): {
    l0: { used: number; capacity: number; failures: number }
    l1: { used: number; capacity: number; failures: number }
    totalFailures: number
  } {
    let used = 0
    let capacity = 0
    let failures = 0
    for (let i = 0; i < this.geometryStreamCount; i++) {
      const p = this.streamPressure(i)
      used += p.used
      capacity += p.capacity
      failures += p.failures
    }
    const l0 = { used, capacity, failures }
    const l1 = this.streamPressure(this.billboardStream)
    return { l0, l1, totalFailures: l0.failures + l1.failures }
  }

  // === Private ===

  private clearInstances(stream: number, offset: number, count: number): void {
    const mesh = this.streams[stream].mesh
    const dst = mesh.instanceMatrix.array as Float32Array
    for (let i = 0; i < count; i++) {
      dst.set(InstancePool.ZERO_MATRIX, (offset + i) * 16)
    }

    // Обнулить fade освобождённого диапазона — чтобы переиспользуемый слот не
    // унаследовал остаточную видимость до первой записи менеджером.
    const fade = this.fadeAttribute(stream).array as Float32Array
    fade.fill(0, offset, offset + count)
    this.dirtyFadeStreams.add(stream)
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

  private recalcHighWaterMark(stream: number): void {
    const s = this.streams[stream]
    const freeList = s.freeList

    if (freeList.length === 0) {
      s.hwm = s.capacity
      return
    }

    const lastFree = freeList[freeList.length - 1]
    if (lastFree.offset + lastFree.count === s.capacity) {
      s.hwm = lastFree.offset
    } else {
      s.hwm = s.capacity
    }
  }

  /**
   * Полный сброс всех буферов и free-lists (всех стримов, включая billboard).
   */
  public reset(): void {
    for (const s of this.streams) {
      s.freeList = [{ offset: 0, count: s.capacity }]
      s.hwm = 0
      s.failures = 0
      s.mesh.count = 0
    }

    this.dirtyStreams.clear()
    this.dirtyFadeStreams.clear()
  }
}

export { InstancePool, LODLevel }
export type { Allocation, PoolLayerConfig }
