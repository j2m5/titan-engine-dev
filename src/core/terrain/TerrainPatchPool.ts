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
 * «без дыр» в TerrainSphere) — 640 пробивается. 1024 слота = ~257 МБ
 * атрибутов (14 float на вершину: position 3 + detailPos 3 + detailPos2 3 +
 * height 1 + midTilt 2 + midShade 2; patchCenter — 3 float на ПАТЧ, TERRAIN_PATCH_SEGMENTS=64
 * → 4481 вершина на патч); пул с морфом (рельеф) несёт ещё 7 float на вершину
 * (morphDelta 3 + midTiltParent 2 + midShadeParent 2) и patchMorph 1 float на
 * патч — 21 float, ~385 МБ на 1024 слота. Ленивая аллокация (createHandle зовётся по факту, не
 * заранее) — платит только дошедший до этой глубины набор. Потолок страхует
 * от неограниченного роста при патологическом отборе (камера в стене,
 * дребезг), не отражает штатный размер набора.
 *
 * Водный пул (WATER_MAX_LIVE_PATCHES, см. WaterSphere, 256 слотов) без морфа
 * платит базовые 14 float на вершину — detailPos/detailPos2, height, midTilt и midShade заведены пулом
 * безусловно (общая TerrainPatchPool), хотя WaterMaterial их не читает;
 * осознанная цена общего пула, та же, что у detailPos.
 */
export const MAX_LIVE_PATCHES = 1024

export type PatchHandle = { mesh: Mesh; geometry: InstancedBufferGeometry }

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
  private readonly morph: boolean
  private slotBytes = -1

  public constructor(
    material: Material,
    segments: number,
    maxLivePatches: number = MAX_LIVE_PATCHES,
    morph = false
  ) {
    this.material = material
    this.morph = morph
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
   * Байт атрибутов одного слота (вершинные + инстансные, без общего индекса):
   * сумма byteLength реальных массивов, замер на пробном слоте один раз —
   * новый атрибут в createHandle попадает сюда сам.
   */
  public get bytesPerSlot(): number {
    if (this.slotBytes < 0) {
      const probe = this.createHandle()
      this.slotBytes = 0
      for (const name of Object.keys(probe.geometry.attributes)) {
        this.slotBytes += probe.geometry.getAttribute(name).array.byteLength
      }
      probe.geometry.setIndex(null)
      probe.geometry.dispose()
    }
    return this.slotBytes
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
    const position = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
    const detailPos = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
    const detailPos2 = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
    const height = new BufferAttribute(new Float32Array(vertexCount), 1)
    const midTilt = new BufferAttribute(new Float32Array(vertexCount * 2), 2)
    const midShade = new BufferAttribute(new Float32Array(vertexCount * 2), 2)
    // Центр патча — один на весь патч (инстансный атрибут, делитель 1):
    // вершинник восстанавливает радиальное направление normalize(position +
    // patchCenter), а атрибуты normal (= то же направление) и uv (мёртв для
    // рендера — фрагментник считает uv сам) сняты.
    const patchCenter = new InstancedBufferAttribute(new Float32Array(3), 3)
    // DynamicDrawUsage: split/merge перезаписывает эти атрибуты на месте
    // каждый раз, когда слот переиспользуется (buildTerrainPatchInto) — не
    // однократная запись, которую предполагает дефолтный StaticDrawUsage.
    for (const attribute of [position, detailPos, detailPos2, height, midTilt, midShade, patchCenter]) {
      attribute.setUsage(DynamicDrawUsage)
    }
    geometry.setAttribute('position', position)
    geometry.setAttribute('detailPos', detailPos)
    geometry.setAttribute('detailPos2', detailPos2)
    geometry.setAttribute('height', height)
    geometry.setAttribute('midTilt', midTilt)
    geometry.setAttribute('midShade', midShade)
    geometry.setAttribute('patchCenter', patchCenter)
    if (this.morph) {
      // родительская форма для геоморфинга (см. buildTerrainPatchArrays) + прогресс перехода патча
      const morphDelta = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
      const midTiltParent = new BufferAttribute(new Float32Array(vertexCount * 2), 2)
      const midShadeParent = new BufferAttribute(new Float32Array(vertexCount * 2), 2)
      const patchMorph = new InstancedBufferAttribute(new Float32Array(1), 1)
      for (const attribute of [morphDelta, midTiltParent, midShadeParent, patchMorph]) {
        attribute.setUsage(DynamicDrawUsage)
      }
      geometry.setAttribute('morphDelta', morphDelta)
      geometry.setAttribute('midTiltParent', midTiltParent)
      geometry.setAttribute('midShadeParent', midShadeParent)
      geometry.setAttribute('patchMorph', patchMorph)
    }
    geometry.setIndex(this.index)

    const mesh = new Mesh(geometry, this.material)
    mesh.userData.clickable = true
    mesh.frustumCulled = true

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
