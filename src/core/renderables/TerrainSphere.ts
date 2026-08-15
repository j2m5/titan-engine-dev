import { Frustum, Group, Matrix4, Vector3, type WebGLRenderer } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'
import type { UpdateContext } from '@/core/UpdateContext'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'
import { CLEARANCE_MARGIN_METERS, TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { CUBE_FACES, TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'
import { buildTerrainPatchInto } from '@/core/terrain/terrainPatchGeometry'
import { TerrainPatchPool, type PatchHandle } from '@/core/terrain/TerrainPatchPool'
import {
  selectTerrainNodes,
  terrainNodeKey,
  TERRAIN_QUADTREE_MIN_LEVEL,
  type TerrainNodeAddress
} from '@/core/terrain/terrainQuadtreeSelect'

/** Построек патчей за один кадр — раздвигает набор постепенно, не роняя кадр на дальнем приближении. */
export const PATCH_BUILDS_PER_FRAME = 6

/**
 * Рельеф тела кубосферой из патчей ПЕРЕМЕННОЙ глубины: каждый кадр
 * selectTerrainNodes отбирает желаемый набор листьев по экранной ошибке,
 * updateObject доводит фактические патчи (пул, split/merge без аллокаций
 * геометрий) до этого набора с бюджетом PATCH_BUILDS_PER_FRAME построек.
 *
 * Инвариант «без дыр»: показанный узел, переставший быть желаемым,
 * освобождается ТОЛЬКО когда его замена готова — либо все желаемые листья
 * внутри него построены (дробится мельче), либо построен желаемый предок
 * (схлопывается крупнее), см. coverageReady. До этого момента старый и
 * новый узлы видны одновременно (перекрытие допустимо, дыра — нет).
 *
 * model/type/clickable — на группе (SceneObserver и коллизия видят её как
 * прежний меш планеты); patches делят один PlanetMaterial — контракт
 * ResourceObserver (.material). RTC: вершины патча относительны его центру,
 * центр — в position меша.
 *
 * dispose() освобождает пул (свободные слоты + общий индекс) и живые меши
 * (disposeSceneTree на каждый — геометрия/материал, материал общий и
 * dispose идемпотентен). Метод и есть тот самый Disposable, которого при
 * обходе сцены дожидается disposeSceneTree родителя — двойной dispose узлов,
 * уже освобождённых им напрямую, безвреден по тому же контракту.
 */
class TerrainSphere extends Group {
  public model: Actor
  private readonly field: TerrainHeightField
  private readonly sharedMaterial: PlanetMaterial
  private readonly pool: TerrainPatchPool
  private readonly live = new Map<string, { handle: PatchHandle; address: TerrainNodeAddress }>()
  private persistedSplit: ReadonlySet<string> = new Set()
  private poolExhaustedWarned = false

  // скретчи кадра: updateObject зовётся каждый кадр, аллокаций быть не должно
  private readonly cameraWorldScratch = new Vector3()
  private readonly viewProjScratch = new Matrix4()
  private readonly frustumScratch = new Frustum()

  public constructor(
    model: Actor,
    field: TerrainHeightField,
    private readonly renderer: WebGLRenderer
  ) {
    super()
    this.model = model
    this.field = field
    this.sharedMaterial = new PlanetMaterial(model)
    this.pool = new TerrainPatchPool(this.sharedMaterial, TERRAIN_PATCH_SEGMENTS)

    // минимальный набор всегда есть (быстрый старт) — MIN_LEVEL всегда
    // спускается безусловно, split пуст (история гистерезиса ещё не набрана)
    const patches = 2 ** TERRAIN_QUADTREE_MIN_LEVEL
    for (let face = 0; face < CUBE_FACES; face++) {
      for (let j = 0; j < patches; j++) {
        for (let i = 0; i < patches; i++) {
          this.buildInitialPatch({ face, level: TERRAIN_QUADTREE_MIN_LEVEL, i, j })
        }
      }
    }

    this.name = this.model.getAttribute('name', '') + 'Planet'
    this.userData.type = 'planet'
    this.userData.clickable = true
  }

  /** Контракт ResourceObserver: у renderable один материал на все патчи. */
  public get material(): PlanetMaterial {
    return this.sharedMaterial
  }

  public updateObject(ctx: UpdateContext): void {
    if (!this.visible) return // FakePlanet издалека — квадродерево заморожено

    ctx.camera.updateMatrixWorld() // matrixWorld И matrixWorldInverse (Camera override)
    this.updateWorldMatrix(true, false)

    const cameraLocal = this.worldToLocal(ctx.camera.getWorldPosition(this.cameraWorldScratch))

    this.viewProjScratch.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse)
    this.viewProjScratch.multiply(this.matrixWorld)
    this.frustumScratch.setFromProjectionMatrix(this.viewProjScratch)

    const { leaves, split } = selectTerrainNodes({
      field: this.field,
      cameraLocal,
      frustumLocal: this.frustumScratch,
      screenHeight: this.renderer.domElement.height,
      fovYRadians: degToRad(ctx.camera.fov),
      splitPixels: config('terrain.sseSplitPixels'),
      mergeFactor: config('terrain.sseMergeFactor'),
      currentlySplit: this.persistedSplit
    })
    this.persistedSplit = split

    const wanted = new Map<string, TerrainNodeAddress>()
    for (const address of leaves) wanted.set(terrainNodeKey(address), address)

    // очередь построек пересобирается из свежего дифа каждый кадр. leaves —
    // DFS-обход пространства квадродерева (спуск по face/i/j), НЕ порядок
    // грубое→мелкое, вопреки прежней формулировке здесь. Спека просила
    // приоритет по SSE; сортировка по level по возрастанию — дешёвый прокси
    // (сотни элементов раз в кадр, полноценная сортировка по SSE того не
    // стоит): coarse-first ближе всего заполняет крупные дыры первым.
    const buildQueue = [...leaves].sort((a, b) => a.level - b.level)

    let built = 0
    for (const address of buildQueue) {
      if (built >= PATCH_BUILDS_PER_FRAME) break

      const key = terrainNodeKey(address)
      if (this.live.has(key)) continue

      const handle = this.pool.acquire()
      if (!handle) {
        this.warnPoolExhausted()
        continue
      }

      this.writePatch(handle, address)
      this.live.set(key, { handle, address })
      built++
    }

    // без дыр: показанный узел освобождается только когда готова его замена
    for (const [key, entry] of this.live) {
      if (wanted.has(key)) continue
      if (!this.coverageReady(entry.address, wanted)) continue

      this.remove(entry.handle.mesh)
      this.pool.release(entry.handle)
      this.live.delete(key)
    }
  }

  public dispose(): void {
    this.pool.dispose()
    for (const { handle } of this.live.values()) disposeSceneTree(handle.mesh)
    this.live.clear()
  }

  private buildInitialPatch(address: TerrainNodeAddress): void {
    const handle = this.pool.acquire()
    if (!handle) {
      this.warnPoolExhausted() // MAX_LIVE_PATCHES ≫ минимального набора — не должно случаться
      return
    }

    this.writePatch(handle, address)
    this.live.set(terrainNodeKey(address), { handle, address })
  }

  private writePatch(handle: PatchHandle, address: TerrainNodeAddress): void {
    // юбка закрывает недобор ГРУБОГО соседа, не свой: фрустум-гейт допускает
    // перепад до двух уровней (сосед вне фрустума не сплитится), поэтому
    // глубина берётся по ε(level−2) — на дне (ℓ6) это 746 м стенки против
    // патча 42 км
    const skirtLevel = Math.max(TERRAIN_QUADTREE_MIN_LEVEL, address.level - 2)
    const skirtDepthUnits = toThreeJSUnits((this.field.geometricErrorMeters(skirtLevel) + CLEARANCE_MARGIN_METERS) / 1000)

    buildTerrainPatchInto(
      this.field,
      address.face,
      address.i,
      address.j,
      address.level,
      TERRAIN_PATCH_SEGMENTS,
      skirtDepthUnits,
      handle
    )
    handle.mesh.userData.terrainAddress = address
    this.add(handle.mesh)
  }

  private warnPoolExhausted(): void {
    if (this.poolExhaustedWarned) return
    console.warn('[TerrainSphere] пул патчей исчерпан — деталь ограничена')
    this.poolExhaustedWarned = true
  }

  /**
   * x (показанный, но не желаемый узел) готов к освобождению, когда готова
   * его замена: либо ВСЕ желаемые листья внутри x построены (x дробится
   * мельче), либо построен желаемый предок x (x схлопывается крупнее).
   * Отношение — префикс адреса: тот же face, i>>Δ/j>>Δ совпадают на разнице
   * уровней (Δ = |level x − level y|).
   */
  private coverageReady(x: TerrainNodeAddress, wanted: ReadonlyMap<string, TerrainNodeAddress>): boolean {
    let hasDescendant = false

    for (const y of wanted.values()) {
      if (y.face !== x.face || y.level <= x.level) continue

      const delta = y.level - x.level
      if ((y.i >> delta) === x.i && (y.j >> delta) === x.j) {
        hasDescendant = true
        if (!this.live.has(terrainNodeKey(y))) return false
      }
    }
    if (hasDescendant) return true

    for (const y of wanted.values()) {
      if (y.face !== x.face || y.level >= x.level) continue

      const delta = x.level - y.level
      if ((x.i >> delta) === y.i && (x.j >> delta) === y.j) {
        return this.live.has(terrainNodeKey(y))
      }
    }

    return false // связи не нашлось — не должно случаться, но пин безопаснее дыры
  }
}

export { TerrainSphere }
