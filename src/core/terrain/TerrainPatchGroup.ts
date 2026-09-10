import { Frustum, Group, Material, Matrix4, Mesh, Vector3, type WebGLRenderer } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'
import type { UpdateContext } from '@/core/UpdateContext'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'
import { CLEARANCE_MARGIN_METERS, TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { CUBE_FACES, TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'
import { buildTerrainPatchInto } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor, type DetailWrap } from '@/core/terrain/detailWrap'
import { TerrainPatchPool, type PatchHandle } from '@/core/terrain/TerrainPatchPool'
import {
  byBuildPriority,
  coverageReady,
  forEachWantedDescendant,
  hasLiveDescendant,
  liveAncestorKey,
  selectTerrainNodes,
  terrainNodeKey,
  TERRAIN_QUADTREE_MIN_LEVEL,
  type TerrainLeaf,
  type TerrainNodeAddress
} from '@/core/terrain/terrainQuadtreeSelect'

/**
 * Общая машинерия квадродерева патчей кубосферы: пул, отбор по SSE
 * (selectTerrainNodes), гистерезис split/merge без дыр, юбки, dispose.
 * Владелец — TerrainSphere (рельеф) и WaterSphere (водная оболочка,
 * константное поле «уровень») — оба тела кубосферы, различаются только
 * ПОЛЕМ высот и МАТЕРИАЛОМ патчей; сам отбор/пул/дыры одинаковы для обоих,
 * поэтому здесь, а не продублированы.
 *
 * Каждый кадр selectTerrainNodes отбирает желаемый набор листьев по
 * экранной ошибке, updateObject доводит фактические патчи (пул, split/merge
 * без аллокаций геометрий) до этого набора с временны́м бюджетом построек за
 * кадр (terrain.lod.patchBuildBudgetMs) — минимум одна постройка происходит
 * всегда, дальше цикл идёт, пока не исчерпан бюджет.
 *
 * Инвариант «без дыр»: показанный узел, переставший быть желаемым,
 * освобождается ТОЛЬКО когда его замена готова — либо все желаемые листья
 * внутри него построены (дробится мельче), либо построен желаемый предок
 * (схлопывается крупнее), см. coverageReady. Своп атомарен: новые патчи
 * входят в сцену скрытыми и показываются РОВНО в кадр освобождения заменяемого
 * узла — перекрытия старого и нового больше нет, z-fight между двумя уровнями
 * не возникает.
 *
 * patches делят один материал (аргумент конструктора) — контракт
 * ResourceObserver (.material на TerrainSphere) остаётся за наследником, эта
 * база сама его наружу не выставляет. RTC: вершины патча относительны его
 * центру, центр — в position меша.
 *
 * dispose() освобождает пул (свободные слоты + общий индекс) и живые меши
 * (disposeSceneTree на каждый — геометрия/материал, материал общий и
 * dispose идемпотентен). Метод и есть тот самый Disposable, которого при
 * обходе сцены дожидается disposeSceneTree родителя — двойной dispose узлов,
 * уже освобождённых им напрямую, безвреден по тому же контракту.
 *
 * Геометрия патча несёт также detailPos/detailPos2 — домен детальных слоёв
 * (см. detailWrap.ts), периоды которого приходят сюда параметром detailWrap.
 */
abstract class TerrainPatchGroup extends Group {
  private readonly field: TerrainHeightField
  private readonly pool: TerrainPatchPool
  private readonly live = new Map<number, { handle: PatchHandle; address: TerrainNodeAddress }>()
  private persistedSplit: ReadonlySet<number> = new Set()
  private poolExhaustedWarned = false
  // замыкание переиспользуется между кадрами — coverageReady зовётся на каждый
  // освобождаемый узел, аллокация лямбды на вызов была бы мусором в горячем пути
  private readonly isLive = (key: number): boolean => this.live.has(key)
  // тот же приём, что isLive: колбэк forEachWantedDescendant зовётся на каждый
  // желаемый лист внутри освобождаемого узла — лямбда на вызов была бы мусором.
  // revealedDescendant — флаг «спуск что-то показал» вместо локальной переменной
  // по той же причине (замыкание на витке цикла освобождения было бы аллокацией)
  private revealedDescendant = false
  private readonly showLive = (key: number): void => {
    this.revealedDescendant = true
    const entry = this.live.get(key)
    if (entry) entry.handle.mesh.visible = true
  }

  // скретчи кадра: updateObject зовётся каждый кадр, аллокаций быть не должно
  private readonly cameraWorldScratch = new Vector3()
  private readonly viewProjScratch = new Matrix4()
  private readonly frustumScratch = new Frustum()

  protected constructor(
    field: TerrainHeightField,
    material: Material,
    private readonly renderer: WebGLRenderer,
    maxLivePatches?: number,
    /**
     * Уровень воды тела, метры (Task 5, water-foundation) — ручка актора, не
     * поля (см. докблок `TerrainHeightField.waterSurfaceRadiusUnits`).
     * TerrainSphere передаёт свою (гейт SSE-потолка подводных патчей суши,
     * см. `terrainQuadtreeSelect`); WaterSphere не передаёт вовсе — её
     * собственное константное поле уже РАВНО уровню везде (h≡level), потолок
     * там условие `h < level − margin` не пробивает никогда, поэтому лишний
     * параметр ей не нужен.
     */
    private readonly waterLevelMeters?: number,
    private readonly detailWrap: DetailWrap = detailWrapFor(undefined),
    /**
     * Часы бюджета построек (terrain.lod.patchBuildBudgetMs), инъекция для
     * теста — детерминированная последовательность вместо реальных мс.
     * Дефолт performance.now() не спорит с запретом брать время в обход
     * UpdateContext (см. докблок onVisibleUpdate ниже): там речь про
     * СОСТОЯНИЕ анимации (uTime), здесь — внутрикадровая длительность уже
     * прошедших построек ЭТОГО кадра, к симуляционному ctx.elapsed отношения
     * не имеющая.
     */
    private readonly nowMs: () => number = () => performance.now()
  ) {
    super()
    this.field = field
    this.pool = new TerrainPatchPool(material, TERRAIN_PATCH_SEGMENTS, maxLivePatches)

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
  }

  public updateObject(ctx: UpdateContext): void {
    // невидимый уровень LOD — квадродерево заморожено. Проверка родителя
    // нужна отдельно от своего visible: LOD.update() переключает .visible
    // ТОЛЬКО у объектов, добавленных через addLevel (сама группа уровня —
    // TerrainSphere), а не рекурсивно у их детей; WaterSphere висит ребёнком
    // TerrainSphere (не отдельным уровнем LOD, см. RenderableFactory), её
    // собственный visible остаётся true всегда — сцена traverse зовёт
    // updateObject независимо от видимости предков. Один уровень вверх
    // достаточен (родитель WaterSphere — ровно тот объект, чей visible LOD
    // переключает); общего обхода до корня сцены здесь не требуется.
    if (!this.visible || this.parent?.visible === false) return

    this.onVisibleUpdate(ctx)

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
      currentlySplit: this.persistedSplit,
      waterLevelMeters: this.waterLevelMeters
    })
    this.persistedSplit = split

    const wanted = new Map<number, TerrainLeaf>()
    for (const address of leaves) wanted.set(terrainNodeKey(address), address)

    // очередь построек пересобирается из свежего дифа каждый кадр. Постройка
    // одна за кадр (бюджет ниже) — порядок решает, что появится первым:
    // видимые узлы идут раньше невидимых (мерж за спиной не должен опережать
    // сплит перед камерой), среди видимых — с наибольшей SSE (самый грубый
    // на экране закрывается первым), среди невидимых — грубые впереди
    // (крупные дыры сзади/сбоку закрываются раньше мелких), см. byBuildPriority.
    const buildQueue = [...leaves].sort(byBuildPriority)

    // временной бюджет вместо счётчика: минимум одна постройка гарантирована
    // всегда (built===0 пропускает проверку), дальше цикл идёт, пока
    // nowMs()−frameStart не достигнет бюджета — гейт СТАРТА следующей
    // постройки, сама постройка атомарна (не прерывается серединой). Часы
    // читаются ПОСЛЕ пропуска уже живых узлов — их пропуск дешёвый lookup,
    // не постройка, и не должен тратить бюджет впустую.
    const budgetMs = config('terrain.lod.patchBuildBudgetMs')
    const frameStart = this.nowMs()
    let built = 0
    for (const address of buildQueue) {
      const key = terrainNodeKey(address)
      if (this.live.has(key)) continue

      const elapsedMs = this.nowMs() - frameStart
      if (built > 0 && elapsedMs >= budgetMs) break

      const handle = this.pool.acquire()
      if (!handle) {
        this.warnPoolExhausted()
        continue
      }

      this.writePatch(handle, address, false)
      this.live.set(key, { handle, address })
      built++
    }

    // без дыр: показанный узел освобождается только когда готова его замена;
    // замена показывается в тот же кадр (атомарный своп): все живые потомки при
    // дроблении, живой предок — при схлопывании
    for (const [key, entry] of this.live) {
      if (wanted.has(key)) continue
      if (!coverageReady(entry.address, wanted, this.isLive)) continue

      // ветки coverageReady взаимоисключающи: спуск что-то показал ⇒ узел
      // дробился (все желаемые листья внутри него живы), предок в этом случае
      // не при чём — подъём не считается вовсе
      this.revealedDescendant = false
      forEachWantedDescendant(entry.address, wanted, this.showLive)
      if (!this.revealedDescendant) {
        const ancestor = liveAncestorKey(entry.address, this.isLive)
        if (ancestor !== -1 && wanted.has(ancestor)) this.showLive(ancestor)
      }

      this.remove(entry.handle.mesh)
      this.pool.release(entry.handle)
      this.live.delete(key)
    }

    // страховка от дыр: скрытый узел, которого никто живой не перекрывает,
    // показывается сразу. При исправном показе замены выше сюда не доходит
    // никто — проход держит инвариант, а не участвует в обычном свопе
    for (const entry of this.live.values()) {
      if (entry.handle.mesh.visible) continue
      if (liveAncestorKey(entry.address, this.isLive) !== -1) continue
      if (hasLiveDescendant(entry.address, this.live)) continue
      entry.handle.mesh.visible = true
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

    this.writePatch(handle, address, true)
    this.live.set(terrainNodeKey(address), { handle, address })
  }

  /**
   * `visible` — стартовая видимость патча: минимальный набор конструктора
   * входит видимым (заменять нечего, скрытый старт был бы дырой), постройки
   * кадра — скрытыми, до кадра освобождения заменяемого узла (атомарный своп,
   * см. докблок класса).
   */
  private writePatch(handle: PatchHandle, address: TerrainNodeAddress, visible: boolean): void {
    // юбка закрывает недобор ГРУБОГО соседа, не свой: фрустум-гейт допускает
    // перепад до двух уровней (сосед вне фрустума не сплитится), поэтому
    // глубина берётся по ε(level−2); на глубоких уровнях (L7–L8) ε мала,
    // стенка — метры при патче в километры
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
      handle,
      this.detailWrap
    )
    handle.mesh.userData.terrainAddress = address
    this.configurePatchMesh(handle.mesh)
    this.add(handle.mesh)
    handle.mesh.visible = visible
  }

  /**
   * Хук наследника: доводка меша патча сверх дефолтов пула (renderOrder,
   * userData.clickable и т.п.) — TerrainSphere дефолтов пула не трогает,
   * WaterSphere здесь ставит renderOrder и снимает clickable.
   */
  protected configurePatchMesh(_mesh: Mesh): void {}

  /**
   * Хук наследника: вызывается РОВНО когда дерево фактически проснётся в
   * этом кадре (после гварда видимости, до самого отбора/построек) — не
   * реже, не чаще. WaterSphere здесь освежает гейт USE_WATER_DEPTH своего
   * материала (slope-текстура актора стримится асинхронно и приходит уже
   * ПОСЛЕ конструктора — см. WaterMaterial.updateMaterial): без хука либо
   * пришлось бы дублировать здесь же гвард видимости (дрейф двух копий
   * условия), либо материал никогда не узнал бы о догрузившейся текстуре
   * (ResourceObserver видит только node.renderable — TerrainSphere, не её
   * ребёнка). TerrainSphere хук не переопределяет — поведение не меняется.
   *
   * Принимает `ctx` (арка water-shader, фикс-раунд 1, №3): WaterSphere читает
   * `ctx.elapsed` для `uTime` волн — «звёздное» глобальное время
   * (`performance.now()`) было дрейфом мимо `UpdateContext`, чей докблок прямо
   * запрещает материалам брать время откуда-то ещё. `_ctx` здесь не читается
   * (TerrainSphere хук не переопределяет), но параметр обязан присутствовать
   * в базовой сигнатуре — иначе `updateObject` не смог бы передать `ctx`
   * переопределяющим потомкам типобезопасно.
   */
  protected onVisibleUpdate(_ctx: UpdateContext): void {}

  private warnPoolExhausted(): void {
    if (this.poolExhaustedWarned) return
    console.warn('[TerrainPatchGroup] пул патчей исчерпан — деталь ограничена')
    this.poolExhaustedWarned = true
  }

}

export { TerrainPatchGroup }
