import { Frustum, Group, Material, Matrix4, Mesh, Vector3, type WebGLRenderer } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'
import type { UpdateContext } from '@/core/UpdateContext'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'
import { CLEARANCE_MARGIN_METERS, TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { CUBE_FACES, TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'
import { applyPatchResult } from '@/core/terrain/terrainPatchGeometry'
import {
  SyncTerrainPatchBuilder,
  type PatchBuildResult,
  type TerrainPatchBuilder
} from '@/core/terrain/terrainPatchBuilder'
import { detailWrapFor, type DetailWrap } from '@/core/terrain/detailWrap'
import { TerrainPatchPool, type PatchHandle } from '@/core/terrain/TerrainPatchPool'
import {
  byBuildPriority,
  coverageReady,
  forEachWantedDescendant,
  liveAncestorKey,
  selectTerrainNodes,
  terrainNodeKey,
  TERRAIN_QUADTREE_MIN_LEVEL,
  type TerrainLeaf,
  type TerrainNodeAddress
} from '@/core/terrain/terrainQuadtreeSelect'

export const POOL_PRESSURE_START = 0.85
export const POOL_PRESSURE_GAIN = 3

/**
 * Порог сплита с учётом заполнения пула: ниже POOL_PRESSURE_START — базовый,
 * при полном пуле ×(1 + GAIN) — набор коарсится, родители становятся
 * желаемыми, слоты возвращаются. Без клапана acquire()→null при полном пуле
 * и освобождение по coverageReady замыкались в тупик.
 */
export function effectiveSplitPixels(base: number, live: number, max: number): number {
  const pressure = max > 0 ? live / max : 0
  return base * (1 + POOL_PRESSURE_GAIN * Math.max(0, (pressure - POOL_PRESSURE_START) / (1 - POOL_PRESSURE_START)))
}

/** Запрошенный, но не пришедший патч: слот уже захвачен, меша в сцене ещё нет. */
interface PendingEntry {
  handle: PatchHandle
  address: TerrainNodeAddress
  requestId: number
  initial: boolean
}

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
 * без аллокаций геометрий) до этого набора, ЗАПРАШИВАЯ постройки у строителя
 * (TerrainPatchBuilder): синхронный строит внутри запроса (минимум одна
 * постройка за кадр, дальше — пока не исчерпан terrain.lod.patchBuildBudgetMs),
 * воркерный отвечает позже, и очередь правит потолок terrain.lod.buildInFlight.
 *
 * pending — запрошенные, но не пришедшие патчи: слот пула захвачен сразу (его
 * видит клапан давления, и повторного запроса того же узла не будет), но меш
 * НЕ в сцене и НЕ в live — покрытием такой узел не считается, заменяемый
 * родитель живёт до прихода. Приход пишет результат в слот, добавляет меш
 * скрытым (своп его покажет) и переводит узел в live; узел, успевший выйти из
 * желаемого набора, возвращает слот в пул.
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
 * dispose() возвращает в пул слоты живых и запрошенных патчей (после него
 * приход результата ничего не пишет), освобождает пул (свободные слоты +
 * общий индекс) и живые меши (disposeSceneTree на каждый — геометрия/материал,
 * материал общий и dispose идемпотентен). Метод и есть тот самый Disposable, которого при
 * обходе сцены дожидается disposeSceneTree родителя — двойной dispose узлов,
 * уже освобождённых им напрямую, безвреден по тому же контракту.
 *
 * Геометрия патча несёт также detailPos/detailPos2 — домен детальных слоёв
 * (см. detailWrap.ts), периоды которого приходят сюда параметром detailWrap.
 */
/** Запрошенный, но не пришедший патч: слот уже захвачен, меша в сцене ещё нет. */
interface PendingEntry {
  handle: PatchHandle
  address: TerrainNodeAddress
  requestId: number
  initial: boolean
}

abstract class TerrainPatchGroup extends Group {
  private readonly field: TerrainHeightField
  private readonly pool: TerrainPatchPool
  private readonly live = new Map<number, { handle: PatchHandle; address: TerrainNodeAddress }>()
  private readonly pending = new Map<number, PendingEntry>()
  // номер запроса отличает приход «своего» задания от прихода задания, чей
  // узел уже успел уйти и вернуться (в pending лежит уже ДРУГОЙ handle)
  private nextRequestId = 1
  private lastWanted: ReadonlyMap<number, TerrainLeaf> = new Map()
  private initialRemaining: number
  private readonly readyCallbacks: Array<() => void> = []
  private disposed = false
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
    private readonly nowMs: () => number = () => performance.now(),
    /**
     * Строитель патчей: дефолт синхронный (постройка внутри запроса —
     * прежнее поведение), воркерный приходит от владельца.
     */
    private readonly builder: TerrainPatchBuilder = new SyncTerrainPatchBuilder()
  ) {
    super()
    this.field = field
    this.pool = new TerrainPatchPool(material, TERRAIN_PATCH_SEGMENTS, maxLivePatches)
    this.builder.acquire(field)

    // минимальный набор всегда есть (быстрый старт) — MIN_LEVEL всегда
    // спускается безусловно, split пуст (история гистерезиса ещё не набрана)
    const patches = 2 ** TERRAIN_QUADTREE_MIN_LEVEL
    this.initialRemaining = CUBE_FACES * patches * patches
    for (let face = 0; face < CUBE_FACES; face++) {
      for (let j = 0; j < patches; j++) {
        for (let i = 0; i < patches; i++) {
          // слота не нашлось (пул меньше минимального набора — не должно
          // случаться): готовности ждать больше не от кого, счётчик закрываем
          if (!this.requestPatch({ face, level: TERRAIN_QUADTREE_MIN_LEVEL, i, j }, true)) this.initialRemaining--
        }
      }
    }
  }

  /** Начальный набор построен целиком — тело можно показывать без дыр. */
  public get ready(): boolean {
    return this.initialRemaining === 0
  }

  /** Запрошено и не пришло — давление на строителя, а не число патчей в сцене. */
  public get pendingCount(): number {
    return this.pending.size
  }

  public whenReady(cb: () => void): void {
    if (this.ready) cb()
    else this.readyCallbacks.push(cb)
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
      // liveCount читается ДО построек этого кадра — давление отстаёт на
      // один кадр от факта (после-release состояние прошлого кадра), но
      // консервативно: потолок acquire() всё равно держит жёсткий кламп
      splitPixels: effectiveSplitPixels(config('terrain.sseSplitPixels'), this.pool.liveCount, this.pool.maxLivePatches),
      mergeFactor: config('terrain.sseMergeFactor'),
      currentlySplit: this.persistedSplit,
      waterLevelMeters: this.waterLevelMeters
    })
    this.persistedSplit = split

    const wanted = new Map<number, TerrainLeaf>()
    for (const address of leaves) wanted.set(terrainNodeKey(address), address)
    // та же Map, без копии: синхронный приход внутри requestPatch ниже уже
    // должен видеть желаемый набор ЭТОГО кадра
    this.lastWanted = wanted

    // очередь пересобирается каждый кадр: при бюджете в одну постройку
    // (ниже) порядок и решает, что появится первым — см. byBuildPriority
    const buildQueue = [...leaves].sort(byBuildPriority)

    // Две ветки одного цикла запросов. Синхронный строитель: запрос и есть
    // постройка, pending после него снова пуст — правит временной бюджет,
    // минимум одна постройка гарантирована (builtHere===0 пропускает
    // проверку), гейт СТАРТА следующей, сама постройка атомарна. Воркерный:
    // запрос дёшев и кадра не тратит, pending растёт — правит потолок
    // запросов в полёте. builtHere — постройки, ЗАВЕРШЁННЫЕ на этом потоке в
    // этом кадре (запрошено минус висящее): только они стоили миллисекунд.
    // Часы читаются ПОСЛЕ пропуска уже живых/запрошенных узлов — их пропуск
    // дешёвый lookup, не постройка, и не должен тратить бюджет впустую.
    const inFlightMax = config('terrain.lod.buildInFlight')
    const budgetMs = config('terrain.lod.patchBuildBudgetMs')
    const frameStart = this.nowMs()
    let requested = 0
    for (const address of buildQueue) {
      const key = terrainNodeKey(address)
      if (this.live.has(key) || this.pending.has(key)) continue
      if (this.pending.size >= inFlightMax) break

      const elapsedMs = this.nowMs() - frameStart
      const builtHere = requested - this.pending.size
      if (builtHere > 0 && elapsedMs >= budgetMs) break

      if (!this.requestPatch(address, false)) continue
      requested++
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

    // страховка от дыр: скрытый узел без живого предка показывается сразу;
    // двойное покрытие с ещё живыми потомками допустимо (дыра — нет), обхода
    // потомков не делаем — O(level) на скрытый узел
    for (const entry of this.live.values()) {
      if (entry.handle.mesh.visible) continue
      if (liveAncestorKey(entry.address, this.isLive) !== -1) continue
      entry.handle.mesh.visible = true
    }

    this.pool.trimFree(Math.ceil(this.pool.liveCount / 4) + 16)
  }

  public dispose(): void {
    this.disposed = true
    // слоты запрошенных патчей — назад в пул: их меши в сцену не входили,
    // разбирать (disposeSceneTree) нечего, геометрию снимет pool.dispose()
    for (const { handle } of this.pending.values()) this.pool.release(handle)
    this.pending.clear()
    for (const { handle } of this.live.values()) {
      this.pool.release(handle)
      disposeSceneTree(handle.mesh)
    }
    this.live.clear()
    this.pool.dispose()
    this.builder.release(this.field)
  }

  /**
   * Запрос постройки узла. Слот захватывается СРАЗУ (давление клапана его уже
   * считает, повторного запроса того же узла не будет), меш входит в сцену и
   * в live только при приходе — см. onPatchBuilt.
   *
   * `initial` — минимальный набор конструктора: входит видимым (заменять
   * нечего, скрытый старт был бы дырой) и нужен всегда, даже если к приходу
   * его уже нет в желаемом наборе.
   */
  private requestPatch(address: TerrainNodeAddress, initial: boolean): boolean {
    const handle = this.pool.acquire()
    if (!handle) {
      this.warnPoolExhausted()
      return false
    }

    const key = terrainNodeKey(address)
    const requestId = this.nextRequestId++
    this.pending.set(key, { handle, address, requestId, initial })

    // юбка закрывает недобор ГРУБОГО соседа, не свой: фрустум-гейт допускает
    // перепад до двух уровней (сосед вне фрустума не сплитится), поэтому
    // глубина берётся по ε(level−2); на глубоких уровнях (L7–L8) ε мала,
    // стенка — метры при патче в километры
    const skirtLevel = Math.max(TERRAIN_QUADTREE_MIN_LEVEL, address.level - 2)
    const skirtDepthUnits = toThreeJSUnits((this.field.geometricErrorMeters(skirtLevel) + CLEARANCE_MARGIN_METERS) / 1000)

    this.builder.request(
      {
        field: this.field,
        face: address.face,
        i: address.i,
        j: address.j,
        level: address.level,
        segments: TERRAIN_PATCH_SEGMENTS,
        skirtDepthUnits,
        wrap: this.detailWrap
      },
      (result) => this.onPatchBuilt(key, requestId, result)
    )

    return true
  }

  /**
   * Приход результата. Чужой или устаревший requestId — слот этого запроса уже
   * освобождён другим путём (dispose, отмена), писать некуда; узел, успевший
   * выйти из желаемого набора, отдаёт слот назад в пул. Постройка кадра входит
   * скрытой — до кадра освобождения заменяемого узла (атомарный своп, см.
   * докблок класса).
   */
  private onPatchBuilt(key: number, requestId: number, result: PatchBuildResult): void {
    if (this.disposed) return

    const entry = this.pending.get(key)
    if (!entry || entry.requestId !== requestId) return
    this.pending.delete(key)

    if (!entry.initial && !this.lastWanted.has(key)) {
      this.pool.release(entry.handle)
      return
    }

    applyPatchResult(entry.handle, result)
    entry.handle.mesh.userData.terrainAddress = entry.address
    this.configurePatchMesh(entry.handle.mesh)
    this.add(entry.handle.mesh)
    entry.handle.mesh.visible = entry.initial
    this.live.set(key, { handle: entry.handle, address: entry.address })

    if (entry.initial && --this.initialRemaining === 0) {
      for (const cb of this.readyCallbacks.splice(0)) cb()
    }
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
