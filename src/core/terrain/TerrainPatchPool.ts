import {
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Material,
  Mesh
} from 'three'
import { buildPatchIndex, terrainPatchVertexCount } from './terrainPatchGeometry'

/**
 * Потолок одновременно живых патчей квадродерева. Замер: на HiDPI (H=2160)
 * при τ≈2 желаемый набор SSE-отбора уже 552+ листьев, а живых на переходах
 * split/merge больше (старый и новый узел видны одновременно, см. инвариант
 * «без дыр» в TerrainSphere) — 640 пробивается. Пул рельефа: 15 float на
 * вершину (position 3 + height 1 + midTilt 2 + midShade 2 + morphDelta 3 +
 * midTiltParent 2 + midShadeParent 2) и 10 float на патч (patchCenter 3 +
 * patchMorph 1 + detailOrigin 3 + detailOrigin2 3), TERRAIN_PATCH_SEGMENTS=64
 * → 4481 вершина, 268 900 Б на слот, ~275 МБ на 1024 слота. Домен детали —
 * смещение на патч, вершинник собирает position + detailOrigin. Ленивая
 * аллокация (createHandle зовётся по факту, не заранее) — платит только
 * дошедший до этой глубины набор. Потолок страхует от неограниченного роста
 * при патологическом отборе (камера в стене, дребезг), не отражает штатный
 * размер набора.
 *
 * Водный пул (WATER_MAX_LIVE_PATCHES, 256 слотов) — раскладка `water`: position 3
 * на вершину, patchCenter и detailOrigin на патч, 53 796 Б на слот.
 */
export const MAX_LIVE_PATCHES = 1024

/** Раскладка слота: рельеф — полоса и геоморф; вода — только позиция (WaterMaterial читает position, patchCenter, detailOrigin). */
export type PatchLayout = 'terrain' | 'water'

/** float на вершину и на патч по раскладке — сверяется с фактическими атрибутами слота в тестах. */
const VERTEX_FLOATS: Record<PatchLayout, number> = { terrain: 15, water: 3 }
const INSTANCE_FLOATS: Record<PatchLayout, number> = { terrain: 10, water: 6 }

/** Видеопамять атрибутов одного слота (без общего индекса), байт. */
export function patchSlotBytes(segments: number, layout: PatchLayout): number {
  return (terrainPatchVertexCount(segments) * VERTEX_FLOATS[layout] + INSTANCE_FLOATS[layout]) * Float32Array.BYTES_PER_ELEMENT
}

/** Общий пустой массив отпущенных атрибутов: count атрибута задан раскладкой, не длиной массива. */
const RELEASED: Float32Array = new Float32Array(0)

/** Вершинные атрибуты, которые после заливки в куче не нужны (position резидентна — её читает клик-рейкаст). */
const UPLOAD_ONLY: Record<PatchLayout, readonly string[]> = {
  terrain: ['height', 'midTilt', 'midShade', 'morphDelta', 'midTiltParent', 'midShadeParent'],
  water: []
}

/** Резидентная куча слота: position + инстансные атрибуты, байт. */
export function patchSlotHeapBytes(segments: number, layout: PatchLayout): number {
  return (terrainPatchVertexCount(segments) * 3 + INSTANCE_FLOATS[layout]) * Float32Array.BYTES_PER_ELEMENT
}

export type PatchHandle = { mesh: Mesh; geometry: InstancedBufferGeometry }

/**
 * Пул патчей квадродерева: split/merge переиспользует геометрии слотов
 * (BufferGeometry и GL-буферы); массивы приходят из результата строителя.
 * Один общий index-атрибут на все геометрии пула (та же экономия, что у
 * TerrainSphere этапа 3а). Свободные слоты держат геометрию живой между
 * acquire — освобождаются вместе с индексом только в dispose.
 *
 * Куча: вершинные массивы слота приходят из результата строителя без копии
 * (applyPatchResult) и, кроме position, отпускаются после заливки
 * (onUploadCallback) — в куче живут position (клик-рейкаст) и инстансные
 * атрибуты, patchSlotHeapBytes. Патч вне кадра three не заливает, поэтому
 * до первой заливки position он рисуется без фрустум-каллинга. Скрытый меш
 * держит массивы до показа (транзиент).
 *
 * Контекст WebGL: three на onContextLost зовёт preventDefault(), браузер
 * контекст восстанавливает, и three перезаливает каждый буфер из
 * `attribute.array` — слоты с отпущенными массивами дали бы нулевые буферы
 * (дыры), а следующий приход в такой слот уронил бы рендер. Поэтому на
 * `webglcontextrestored` HeightFieldGate сбрасывает поверхности-рельеф на
 * легаси-сферу (пулы уходят вместе с ними), а следующий пересчёт гейта
 * апгрейдит тела с загруженными картами заново — со свежими пулами.
 *
 * Порядок обращения со слотом (нарушение любого пункта даёт WebGLAttributes
 * нулевой буфер или исключение внутри render): меш слота входит в сцену только
 * после первого applyPatchResult и покидает её до release; задиспоженная
 * геометрия слота больше не рисуется; version upload-only атрибутов поднимает
 * только applyPatchResult — и всегда после записи свежего массива.
 *
 * Материал типизирован общим `Material`, не `PlanetMaterial` — пул сам с
 * материалом не взаимодействует (только держит ссылку для `new Mesh`), а
 * TerrainPatchGroup (общая база TerrainSphere/WaterSphere) передаёт сюда
 * конкретный класс своего потребителя.
 *
 * Потолок живых патчей — необязательный аргумент (дефолт MAX_LIVE_PATCHES):
 * WaterSphere просит свой, меньший (см. её докблок и WATER_MAX_LIVE_PATCHES)
 * — водная оболочка не обязана терпеть тот же пик, что рельеф.
 */
class TerrainPatchPool {
  private readonly material: Material
  private readonly segments: number
  private readonly index: BufferAttribute
  private readonly free: PatchHandle[] = []
  private readonly occupied = new Set<PatchHandle>()
  private readonly maxLivePatchesLimit: number
  public readonly layout: PatchLayout

  public constructor(
    material: Material,
    segments: number,
    layout: PatchLayout,
    maxLivePatches: number = MAX_LIVE_PATCHES
  ) {
    this.material = material
    this.layout = layout
    this.segments = segments
    this.index = buildPatchIndex(segments)
    this.maxLivePatchesLimit = maxLivePatches
  }

  public get liveCount(): number {
    return this.occupied.size
  }

  /** Выделенные, но свободные слоты: держат видеопамять до trimFree/dispose. */
  public get freeCount(): number {
    return this.free.length
  }

  /**
   * Байт атрибутов одного слота (вершинные + инстансные, без общего индекса)
   * по раскладке, см. patchSlotBytes; совпадение с фактическими атрибутами —
   * tests/terrain/patchLayout.spec.ts.
   */
  public get bytesPerSlot(): number {
    return patchSlotBytes(this.segments, this.layout)
  }

  /** Резидентная куча одного слота (position + инстансные), байт — см. patchSlotHeapBytes. */
  public get heapBytesPerSlot(): number {
    return patchSlotHeapBytes(this.segments, this.layout)
  }

  public get maxLivePatches(): number {
    return this.maxLivePatchesLimit
  }

  public acquire(): PatchHandle | null {
    if (this.occupied.size >= this.maxLivePatchesLimit) return null

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
    // слот в свободном списке держит только резидентную часть (position и
    // инстансные атрибуты, patchSlotHeapBytes); version не поднимается —
    // следующая запись прихода поставит массив раньше needsUpdate
    for (const name of UPLOAD_ONLY[this.layout]) (handle.geometry.getAttribute(name) as BufferAttribute).array = RELEASED
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

  /**
   * Возврат памяти после ухода с поверхности: свободных слотов остаётся не
   * больше maxFree, лишние (самые старые в стеке) диспозятся — GPU-буферы и
   * массивы. Индекс отвязывается (`setIndex(null)`) ДО dispose() каждой
   * лишней геометрии — общий GL-буфер живёт до dispose() ПУЛА: WebGL
   * `onGeometryDispose` снимает `attributes.remove(geometry.index)` для
   * ЛЮБОЙ диспозящейся геометрии, а индекс общий по ссылке у всех геометрий
   * пула (см. докблок класса) — без отвязки dispose() свободного слота стирал
   * бы GL-буфер индекса ПОКА живые патчи ещё рисуются им же (тихая
   * пересборка буфера на следующей отрисовке, осиротевшие копии VAO). На
   * подлёте слоты создаются заново (createHandle — доли миллисекунды).
   */
  public trimFree(maxFree: number): number {
    const extra = Math.max(0, this.free.length - Math.max(0, Math.floor(maxFree)))
    for (let k = 0; k < extra; k++) {
      this.free[k].geometry.setIndex(null)
      this.free[k].geometry.dispose()
    }
    this.free.splice(0, extra)
    return extra
  }

  private createHandle(): PatchHandle {
    const vertexCount = terrainPatchVertexCount(this.segments)
    // InstancedBufferGeometry с instanceCount = 1: единственный инстанс — сам
    // патч, инстансный атрибут несёт его центр. Обычный Mesh рисует такую
    // геометрию через renderInstances(…, instanceCount) (WebGLRenderer, ветка
    // isInstancedBufferGeometry); рейкаст и фрустум-каллинг — как у BufferGeometry.
    const geometry = new InstancedBufferGeometry()
    geometry.instanceCount = 1
    const vertexAttribute = (itemSize: number): BufferAttribute => {
      // массив приходит из результата строителя (applyPatchResult, без копии);
      // count — по раскладке, не по длине пустого массива
      const attribute = new BufferAttribute(RELEASED, itemSize)
      ;(attribute as unknown as { count: number }).count = vertexCount
      return attribute
    }
    const position = vertexAttribute(3)
    // Центр патча — один на весь патч (инстансный атрибут, делитель 1):
    // вершинник восстанавливает радиальное направление normalize(position +
    // patchCenter), а атрибуты normal (= то же направление) и uv (мёртв для
    // рендера — фрагментник считает uv сам) сняты.
    const patchCenter = new InstancedBufferAttribute(new Float32Array(3), 3)
    // домен детали — смещение на патч: вершинник собирает position + detailOrigin
    const detailOrigin = new InstancedBufferAttribute(new Float32Array(3), 3)
    // DynamicDrawUsage: split/merge перезаписывает эти атрибуты на месте
    // каждый раз, когда слот переиспользуется (applyPatchResult) — не
    // однократная запись, которую предполагает дефолтный StaticDrawUsage.
    for (const attribute of [position, patchCenter, detailOrigin]) {
      attribute.setUsage(DynamicDrawUsage)
    }
    geometry.setAttribute('position', position)
    geometry.setAttribute('patchCenter', patchCenter)
    geometry.setAttribute('detailOrigin', detailOrigin)
    if (this.layout === 'terrain') {
      const height = vertexAttribute(1)
      const midTilt = vertexAttribute(2)
      const midShade = vertexAttribute(2)
      const detailOrigin2 = new InstancedBufferAttribute(new Float32Array(3), 3)
      // родительская форма для геоморфинга (см. buildTerrainPatchArrays) + прогресс перехода патча
      const morphDelta = vertexAttribute(3)
      const midTiltParent = vertexAttribute(2)
      const midShadeParent = vertexAttribute(2)
      const patchMorph = new InstancedBufferAttribute(new Float32Array(1), 1)
      for (const attribute of [height, midTilt, midShade, detailOrigin2, morphDelta, midTiltParent, midShadeParent, patchMorph]) {
        attribute.setUsage(DynamicDrawUsage)
      }
      geometry.setAttribute('height', height)
      geometry.setAttribute('midTilt', midTilt)
      geometry.setAttribute('midShade', midShade)
      geometry.setAttribute('detailOrigin2', detailOrigin2)
      geometry.setAttribute('morphDelta', morphDelta)
      geometry.setAttribute('midTiltParent', midTiltParent)
      geometry.setAttribute('midShadeParent', midShadeParent)
      geometry.setAttribute('patchMorph', patchMorph)
    }
    geometry.setIndex(this.index)

    const mesh = new Mesh(geometry, this.material)
    mesh.userData.clickable = true
    mesh.frustumCulled = true
    // залитая position возвращает каллинг: до первой заливки патч рисуется
    // без него (applyPatchResult), иначе патч вне кадра держал бы массивы
    position.onUploadCallback = (): void => {
      mesh.frustumCulled = true
    }
    for (const name of UPLOAD_ONLY[this.layout]) {
      const attribute = geometry.getAttribute(name) as BufferAttribute
      attribute.onUploadCallback = (): void => {
        attribute.array = RELEASED
      }
    }

    return { mesh, geometry }
  }
}

/** Прогресс геоморфинга патча 0..1; version растёт только при изменении. Слот без морфа — no-op. */
export function setPatchMorph(handle: PatchHandle, m: number): void {
  const attribute = handle.geometry.getAttribute('patchMorph') as InstancedBufferAttribute | undefined
  if (attribute === undefined || attribute.array[0] === m) return

  ;(attribute.array as Float32Array)[0] = m
  attribute.needsUpdate = true
}

export { TerrainPatchPool }
