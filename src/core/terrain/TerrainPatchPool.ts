import {
  BufferAttribute,
  BufferGeometry,
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
 * «без дыр» в TerrainSphere) — 640 пробивается. 1024 слота = ~220 МБ
 * атрибутов (12 float на вершину: position 3 + detailPos 3 + detailPos2 3 +
 * height 1 + midTilt 2; patchCenter — 3 float на ПАТЧ, TERRAIN_PATCH_SEGMENTS=64
 * → 4481 вершина на патч) при ленивой аллокации (createHandle зовётся по факту, не
 * заранее) — платит только дошедший до этой глубины набор. Потолок страхует
 * от неограниченного роста при патологическом отборе (камера в стене,
 * дребезг), не отражает штатный размер набора.
 *
 * Водный пул (WATER_MAX_LIVE_PATCHES, см. WaterSphere, 256 слотов) платит тот
 * же бюджет на слот — detailPos/detailPos2, height и midTilt заведены пулом
 * безусловно (общая TerrainPatchPool), хотя WaterMaterial их не читает;
 * осознанная цена общего пула, та же, что у detailPos.
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

  public constructor(material: Material, segments: number, maxLivePatches: number = MAX_LIVE_PATCHES) {
    this.material = material
    this.segments = segments
    this.index = buildPatchIndex(segments)
    this.maxLivePatchesLimit = maxLivePatches
  }

  public get liveCount(): number {
    return this.occupied.size
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
    // Центр патча — один на весь патч (инстансный атрибут, делитель 1):
    // вершинник восстанавливает радиальное направление normalize(position +
    // patchCenter), а атрибуты normal (= то же направление) и uv (мёртв для
    // рендера — фрагментник считает uv сам) сняты: 17 → 12 float на вершину.
    const patchCenter = new InstancedBufferAttribute(new Float32Array(3), 3)
    // DynamicDrawUsage: split/merge перезаписывает эти атрибуты на месте
    // каждый раз, когда слот переиспользуется (buildTerrainPatchInto) — не
    // однократная запись, которую предполагает дефолтный StaticDrawUsage.
    for (const attribute of [position, detailPos, detailPos2, height, midTilt, patchCenter]) {
      attribute.setUsage(DynamicDrawUsage)
    }
    geometry.setAttribute('position', position)
    geometry.setAttribute('detailPos', detailPos)
    geometry.setAttribute('detailPos2', detailPos2)
    geometry.setAttribute('height', height)
    geometry.setAttribute('midTilt', midTilt)
    geometry.setAttribute('patchCenter', patchCenter)
    geometry.setIndex(this.index)

    const mesh = new Mesh(geometry, this.material)
    mesh.userData.clickable = true
    mesh.frustumCulled = true

    return { mesh, geometry }
  }
}

export { TerrainPatchPool }
