import { BufferGeometry, InstancedBufferAttribute, InstancedMesh, Object3D, PlaneGeometry } from 'three'
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
  Billboard = 1,
  /**
   * Ближний тир: реальная геометрия повышенной детализации (запечённый
   * архетип, свой detail). Пул держит для неё отдельные стримы
   * (см. nearStreamBase). Менеджер выбирает этот тир по ближайшей точке
   * сектора (distClosest) с гистерезисом входа/выхода — сектор входит в Near,
   * когда distClosest опустился до nearEnterDistance, и остаётся в нём пока
   * distClosest <= nearExitDistance, что исключает осцилляцию на границе.
   */
  GeometryNear = 2
}

/** Результат аллокации. stream: 0..K-1 = архетипы Geometry, K..2K-1 = Near, 2K = billboard. */
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
 * Владеет 2K+1 рендер-объектами: K стримов Geometry (по InstancedMesh на
 * архетип), K стримов Near (те же архетипы, выше detail, своя ёмкость) и один
 * Billboard. Geometry и Near делят материал — профильные юниформы у обоих
 * тиров реальной геометрии общие.
 *
 * У каждого стрима преаллоцированный буфер; секторы берут в нём диапазоны
 * через независимый free-list аллокатор. Итого 2K+1 draw call.
 */
class InstancePool {
  /** Geometry-меши, по одному на архетип (стримы 0..K-1) */
  public readonly geometryMeshes: InstancedMesh[]
  /** Near-меши, по одному на архетип, свой detail (стримы K..2K-1) */
  public readonly nearMeshes: InstancedMesh[]
  /** Материал, общий для ВСЕХ Geometry- и Near-мешей (один инстанс на 2K геометрий) */
  public readonly geometryMaterial: InstancedAsteroidMaterial
  /** Рендер-объект для billboard-стрима (индекс 2K) */
  public billboardMesh: InstancedMesh
  /** Материал billboard (хранится для доступа к uniforms) */
  public billboardMaterial: BillboardAsteroidMaterial

  /** Матрица нулевого масштаба для "скрытия" освобождённых экземпляров */
  private static readonly ZERO_MATRIX = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -99999, 1])

  /**
   * Стримы: индексы 0..K-1 — Geometry-архетипы, K..2K-1 — Near-архетипы,
   * индекс 2K (== billboardStream) — billboard. Единая адресация вместо
   * Map<LODLevel,...>.
   */
  private readonly streams: Stream[]

  /** Dirty-флаги для отложенного commit матриц, по стримам */
  private dirtyStreams: Set<number> = new Set()

  /** Dirty-флаги для отложенного commit fade-атрибута, по стримам */
  private dirtyFadeStreams: Set<number> = new Set()

  /**
   * @param l0Config Ёмкость L0 (Geometry, обычный detail).
   * @param nearConfig Ёмкость Near (Geometry, повышенный detail) — своя,
   *   независимая от l0Config конфигурация.
   * @param l1Config Ёмкость billboard-стрима.
   * @param l0Geometries K геометрий Geometry-архетипов. Пул не строит форму
   *   сам, она приходит извне. K = l0Geometries.length.
   * @param nearGeometries K геометрий Near-архетипов. Длина ОБЯЗАНА совпадать с
   *   l0Geometries, иначе адресация архетипа в двух тирах разъедется.
   * @param billboardSize Сторона PlaneGeometry для billboard-стрима.
   */
  public constructor(
    l0Config: PoolLayerConfig,
    nearConfig: PoolLayerConfig,
    l1Config: PoolLayerConfig,
    l0Geometries: BufferGeometry[],
    nearGeometries: BufferGeometry[],
    billboardSize: number
  ) {
    if (l0Geometries.length !== nearGeometries.length) {
      throw new Error(
        `InstancePool: l0Geometries.length (${l0Geometries.length}) !== nearGeometries.length ` +
          `(${nearGeometries.length}) — оба массива обязаны описывать одну и ту же библиотеку из K архетипов.`
      )
    }

    const streamCount = l0Geometries.length
    // Ёмкость КАЖДОГО Geometry-стрима больше "справедливой" доли maxInstances/K:
    // страховка от локальной фрагментации (сектор с архетипом-меньшинством не
    // должен упираться в потолок раньше, чем исчерпан суммарный бюджет).
    const streamCapacity = Math.ceil((l0Config.maxInstances / streamCount) * 1.5)
    const nearStreamCapacity = Math.ceil((nearConfig.maxInstances / streamCount) * 1.5)

    this.geometryMaterial = new InstancedAsteroidMaterial()
    this.geometryMeshes = []
    this.nearMeshes = []
    this.streams = []

    for (let k = 0; k < streamCount; k++) {
      const { mesh, stream } = this.__buildArchetypeStream(
        l0Geometries[k],
        streamCapacity,
        this.geometryMaterial,
        `AsteroidPool_L0_${k}`
      )
      this.geometryMeshes.push(mesh)
      this.streams.push(stream)
    }

    for (let k = 0; k < streamCount; k++) {
      const { mesh, stream } = this.__buildArchetypeStream(
        nearGeometries[k],
        nearStreamCapacity,
        this.geometryMaterial,
        `AsteroidPool_Near_${k}`
      )
      this.nearMeshes.push(mesh)
      this.streams.push(stream)
    }

    // --- Billboard-стрим (индекс 2·streamCount) ---
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

  /**
   * Обёртка над разделяемой геометрией архетипа: кэш ArchetypeLibrary отдаёт
   * ОДНИ И ТЕ ЖЕ BufferGeometry всем системам одного профиля (для ЛЮБОГО
   * detail — L0 и Near используют один и тот же паттерн), а instanceFade —
   * пер-инстансное состояние ЭТОГО пула. ВСЕ read-only атрибуты источника
   * (position/normal/surfaceData/…) разделяются по ссылке безопасно — GPU-буфер
   * один и они не мутируются; instanceFade — единственный МУТИРУЕМЫЙ, пер-пульный
   * атрибут, поэтому создаётся отдельно, ПОСЛЕ копирования (имена не пересекаются).
   */
  private __buildArchetypeStream(
    source: BufferGeometry,
    capacity: number,
    material: InstancedAsteroidMaterial,
    name: string
  ): { mesh: InstancedMesh; stream: Stream } {
    const streamGeometry = new BufferGeometry()
    for (const attrName of Object.keys(source.attributes)) {
      streamGeometry.setAttribute(attrName, source.getAttribute(attrName))
    }
    if (source.getIndex() !== null) {
      streamGeometry.setIndex(source.getIndex())
    }
    streamGeometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(capacity), 1))

    const mesh = new InstancedMesh(streamGeometry, material, capacity)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.name = name

    return {
      mesh,
      stream: {
        mesh,
        freeList: [{ offset: 0, count: capacity }],
        hwm: 0,
        failures: 0,
        capacity
      }
    }
  }

  /** Количество Geometry-стримов (K архетипов). */
  public get geometryStreamCount(): number {
    return this.geometryMeshes.length
  }

  /** Индекс первого Near-стрима (== K). Near-стримы занимают K..2K-1. */
  public get nearStreamBase(): number {
    return this.geometryMeshes.length
  }

  /** Индекс billboard-стрима (== 2K). */
  public get billboardStream(): number {
    return this.geometryMeshes.length + this.nearMeshes.length
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
   * Получить все рендер-объекты для добавления в сцену (2K+1: K Geometry + K Near + 1 billboard).
   */
  public getRenderObjects(): Object3D[] {
    return [...this.geometryMeshes, ...this.nearMeshes, this.billboardMesh]
  }

  /**
   * Получить общее количество active instances по всем уровням.
   * l0/near — сумма high-water mark по соответствующим K стримам.
   */
  public getActiveCount(): { l0: number; near: number; l1: number; total: number } {
    let l0 = 0
    for (let i = 0; i < this.geometryStreamCount; i++) {
      l0 += this.streams[i].hwm
    }
    let near = 0
    for (let i = 0; i < this.nearMeshes.length; i++) {
      near += this.streams[this.nearStreamBase + i].hwm
    }
    const l1 = this.streams[this.billboardStream].hwm
    return { l0, near, l1, total: l0 + near + l1 }
  }

  /** Занятость и отказы одного стрима (диагностика переполнения) */
  private streamPressure(stream: number): { used: number; capacity: number; failures: number } {
    const s = this.streams[stream]
    const free = s.freeList.reduce((sum, range) => sum + range.count, 0)
    return { used: s.capacity - free, capacity: s.capacity, failures: s.failures }
  }

  /** Просуммировать pressure по диапазону [base, base+count) стримов. */
  private sumStreamPressure(base: number, count: number): { used: number; capacity: number; failures: number } {
    let used = 0
    let capacity = 0
    let failures = 0
    for (let i = base; i < base + count; i++) {
      const p = this.streamPressure(i)
      used += p.used
      capacity += p.capacity
      failures += p.failures
    }
    return { used, capacity, failures }
  }

  /**
   * Диагностика давления на пулы: фактическая занятость (не high-water mark)
   * и накопленные отказы allocate(). Ненулевые failures = сектора молча
   * пропадали из рендера — пора поднимать maxInstances или снижать density.
   *
   * l0 — СУММА used/capacity/failures по всем K Geometry-стримам, near — по
   * всем K Near-стримам (независимая от l0 корзина).
   */
  public getPressureInfo(): {
    l0: { used: number; capacity: number; failures: number }
    near: { used: number; capacity: number; failures: number }
    l1: { used: number; capacity: number; failures: number }
    totalFailures: number
  } {
    const l0 = this.sumStreamPressure(0, this.geometryStreamCount)
    const near = this.sumStreamPressure(this.nearStreamBase, this.nearMeshes.length)
    const l1 = this.streamPressure(this.billboardStream)
    return { l0, near, l1, totalFailures: l0.failures + near.failures + l1.failures }
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
