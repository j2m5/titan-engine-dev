import { BufferGeometry, InstancedBufferAttribute, InstancedMesh, Object3D, PlaneGeometry, Vector3 } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import type { Actor } from '@/core/models/Actor'
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

  /** Dirty-флаги для отложенного commit origin-атрибута, по стримам */
  private dirtyOriginStreams: Set<number> = new Set()

  /** Dirty-флаги для отложенного commit атрибута порога fade билборда, по стримам */
  private dirtyMaxDistanceStreams: Set<number> = new Set()

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
   * @param model Актор кольца — вход подписки на цвет света звезды (lightTint,
   *   см. resolveLightTint); резолвер сам поднимается к корню дерева.
   *   undefined — тинт выключен (тесты пула без реального кольца).
   * @param useCascadeFade Билборд считает fade по инстансному порогу вместо
   *   общего uMaxDistance (см. BillboardAsteroidMaterial); дефолт false —
   *   путь колец и одиночного каскада не меняется.
   * @param useIceVariety Ледяная примесь (см. чанк AsteroidIce) в обоих
   *   материалах — доля тел берёт ручки ледяного профиля; дефолт false —
   *   тексты программ колец не меняются.
   */
  public constructor(
    l0Config: PoolLayerConfig,
    nearConfig: PoolLayerConfig,
    l1Config: PoolLayerConfig,
    l0Geometries: BufferGeometry[],
    nearGeometries: BufferGeometry[],
    billboardSize: number,
    model?: Actor,
    useCascadeFade: boolean = false,
    useIceVariety: boolean = false
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

    this.geometryMaterial = new InstancedAsteroidMaterial(model, undefined, useIceVariety)
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
    this.billboardMaterial = new BillboardAsteroidMaterial(model, useCascadeFade, useIceVariety)
    this.billboardMesh = new InstancedMesh(l1Geometry, this.billboardMaterial, l1Config.maxInstances)
    this.billboardMesh.count = 0
    this.billboardMesh.frustumCulled = false
    this.billboardMesh.name = 'AsteroidPool_L1'

    l1Geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(l1Config.maxInstances), 1))
    l1Geometry.setAttribute(
      'instanceOrigin',
      new InstancedBufferAttribute(new Float32Array(l1Config.maxInstances * 3), 3)
    )
    l1Geometry.setAttribute(
      'instanceMaxDistance',
      new InstancedBufferAttribute(new Float32Array(l1Config.maxInstances), 1)
    )

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
   * один и они не мутируются; instanceFade и instanceOrigin — МУТИРУЕМЫЕ,
   * пер-пульные атрибуты, поэтому создаются отдельно, ПОСЛЕ копирования (имена
   * не пересекаются).
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
    streamGeometry.setAttribute('instanceOrigin', new InstancedBufferAttribute(new Float32Array(capacity * 3), 3))
    // Пишется тем же кодом, что и instanceOrigin (см. SectorManager.writeSectorOrigins),
    // хотя читает его только материал билборда — держим адресацию единой для всех тиров.
    streamGeometry.setAttribute('instanceMaxDistance', new InstancedBufferAttribute(new Float32Array(capacity), 1))

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

  /**
   * Подменить геометрию архетипа k в L0- и Near-стримах — приход реальной
   * модели формы (см. ShapeModelStorage) на место процедурной заглушки.
   * Меш, его матрицы инстансов и буфер instanceFade остаются теми же: меняется
   * только источник вершин. Старая геометрия стрима освобождается; исходные
   * геометрии библиотеки (кэш) не трогаются.
   */
  public replaceArchetypeGeometry(k: number, l0Geometry: BufferGeometry, nearGeometry: BufferGeometry): void {
    this.__swapStreamGeometry(this.geometryMeshes[k], l0Geometry)
    this.__swapStreamGeometry(this.nearMeshes[k], nearGeometry)
  }

  private __swapStreamGeometry(mesh: InstancedMesh | undefined, source: BufferGeometry): void {
    if (!mesh) return
    const old = mesh.geometry
    const fade = old.getAttribute('instanceFade')
    // Смещение сектора от плавающего начала переезжает вместе с fade: оно
    // пер-инстансное состояние стрима, а не свойство формы (см. writeOrigins)
    const origin = old.getAttribute('instanceOrigin')
    const maxDistance = old.getAttribute('instanceMaxDistance')
    const streamGeometry = new BufferGeometry()
    for (const attrName of Object.keys(source.attributes)) {
      streamGeometry.setAttribute(attrName, source.getAttribute(attrName))
    }
    if (source.getIndex() !== null) streamGeometry.setIndex(source.getIndex())
    streamGeometry.setAttribute('instanceFade', fade)
    streamGeometry.setAttribute('instanceOrigin', origin)
    streamGeometry.setAttribute('instanceMaxDistance', maxDistance)
    mesh.geometry = streamGeometry
    old.dispose()
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

  /** InstancedBufferAttribute origin (смещение сектора) для заданного стрима. */
  private originAttribute(stream: number): InstancedBufferAttribute {
    return this.streams[stream].mesh.geometry.getAttribute('instanceOrigin') as InstancedBufferAttribute
  }

  /** InstancedBufferAttribute порога fade билборда СВОЕГО каскада для заданного стрима. */
  private maxDistanceAttribute(stream: number): InstancedBufferAttribute {
    return this.streams[stream].mesh.geometry.getAttribute('instanceMaxDistance') as InstancedBufferAttribute
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
    const attr = this.streams[stream].mesh.instanceMatrix
    const dst = attr.array as Float32Array
    dst.set(matrices, offset * 16)
    attr.addUpdateRange(offset * 16, matrices.length)
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
    attr.addUpdateRange(offset, count)
    this.dirtyFadeStreams.add(stream)
  }

  /**
   * Записать смещение сектора от плавающего начала в диапазон
   * [offset, offset+count) стрима. Значение общее для всего сектора: матрицы
   * инстансов хранят позицию ОТНОСИТЕЛЬНО центра сектора, абсолютная позиция
   * собирается в вершиннике как instanceOrigin + instanceMatrix[3].xyz.
   *
   * Кольца этот метод не зовут вовсе — их буфер остаётся нулевым, и сложение
   * в шейдере тождественно прежнему выражению.
   */
  public writeOrigins(stream: number, offset: number, count: number, origin: Vector3): void {
    const attr = this.originAttribute(stream)
    const dst = attr.array as Float32Array
    for (let i = offset; i < offset + count; i++) {
      dst[i * 3] = origin.x
      dst[i * 3 + 1] = origin.y
      dst[i * 3 + 2] = origin.z
    }
    attr.addUpdateRange(offset * 3, count * 3)
    this.dirtyOriginStreams.add(stream)
  }

  /**
   * Записать порог полного затухания билборда СВОЕГО каскада (см.
   * BillboardAsteroidMaterial, instanceMaxDistance) в диапазон
   * [offset, offset+count) стрима. Значение общее для всего сектора — то же
   * устройство записи, что и у writeOrigins.
   */
  public writeMaxDistance(stream: number, offset: number, count: number, value: number): void {
    const attr = this.maxDistanceAttribute(stream)
    const dst = attr.array as Float32Array
    dst.fill(value, offset, offset + count)
    attr.addUpdateRange(offset, count)
    this.dirtyMaxDistanceStreams.add(stream)
  }

  /**
   * Применить все накопленные изменения к GPU-буферам.
   *
   * Каждая запись в массив атрибута регистрирует свой диапазон
   * (addUpdateRange): рендерер заливает только их, сливая соседние, и сам
   * очищает список после заливки. Без диапазонов флаг обновления лил бы
   * атрибут целиком — при каскадах за кадр грязнятся все потоки, это порядка
   * 16 МБ на кадр. Инвариант: любой путь записи в массив обязан добавить
   * диапазон, иначе при непустом списке слот на GPU останется прежним.
   */
  public commitUpdates(): void {
    for (const stream of this.dirtyStreams) {
      const s = this.streams[stream]
      InstancePool.coalesceRanges(s.mesh.instanceMatrix)
      s.mesh.instanceMatrix.needsUpdate = true
      s.mesh.count = s.hwm
    }

    for (const stream of this.dirtyFadeStreams) {
      const attr = this.fadeAttribute(stream)
      InstancePool.coalesceRanges(attr)
      attr.needsUpdate = true
    }

    for (const stream of this.dirtyOriginStreams) {
      const attr = this.originAttribute(stream)
      InstancePool.coalesceRanges(attr)
      attr.needsUpdate = true
    }

    for (const stream of this.dirtyMaxDistanceStreams) {
      const attr = this.maxDistanceAttribute(stream)
      InstancePool.coalesceRanges(attr)
      attr.needsUpdate = true
    }

    this.dirtyStreams.clear()
    this.dirtyFadeStreams.clear()
    this.dirtyOriginStreams.clear()
    this.dirtyMaxDistanceStreams.clear()
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

  /**
   * Зазор между диапазонами (в инстансах), внутри которого их выгоднее слить в
   * один вызов заливки, чем звать драйвер дважды: слак в 512 инстансов —
   * 32 КБ матриц, а вызовов за кадр вместо полутора тысяч остаются десятки.
   * Верхняя граница лишних байт — зазор на каждое слияние, но сектора кладутся
   * первым свободным местом и лежат плотно: замер даёт объём без слака.
   */
  private static readonly COALESCE_GAP_INSTANCES = 512

  /**
   * Слить диапазоны заливки атрибута, отстоящие не дальше зазора. Рендерер
   * сливает только соприкасающиеся, а сектора лежат в буфере вразброс.
   * Список правится на месте — это тот же массив, который читает рендерер.
   */
  private static coalesceRanges(attr: InstancedBufferAttribute): void {
    const ranges = attr.updateRanges
    if (ranges.length < 2) return

    ranges.sort((a, b) => a.start - b.start)
    const gap = InstancePool.COALESCE_GAP_INSTANCES * attr.itemSize
    let write = 0
    for (let read = 1; read < ranges.length; read++) {
      const kept = ranges[write]
      const next = ranges[read]
      const keptEnd = kept.start + kept.count
      if (next.start <= keptEnd + gap) {
        kept.count = Math.max(keptEnd, next.start + next.count) - kept.start
      } else {
        write++
        ranges[write] = next
      }
    }
    ranges.length = write + 1
  }

  private clearInstances(stream: number, offset: number, count: number): void {
    const mesh = this.streams[stream].mesh
    const dst = mesh.instanceMatrix.array as Float32Array
    for (let i = 0; i < count; i++) {
      dst.set(InstancePool.ZERO_MATRIX, (offset + i) * 16)
    }
    mesh.instanceMatrix.addUpdateRange(offset * 16, count * 16)

    // Обнулить fade освобождённого диапазона — чтобы переиспользуемый слот не
    // унаследовал остаточную видимость до первой записи менеджером.
    const fadeAttr = this.fadeAttribute(stream)
    const fade = fadeAttr.array as Float32Array
    fade.fill(0, offset, offset + count)
    fadeAttr.addUpdateRange(offset, count)
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
    this.dirtyOriginStreams.clear()
    this.dirtyMaxDistanceStreams.clear()
  }
}

export { InstancePool, LODLevel }
export type { Allocation, PoolLayerConfig }
