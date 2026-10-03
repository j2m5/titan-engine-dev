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
import { setPatchMorph, TerrainPatchPool, type PatchHandle } from '@/core/terrain/TerrainPatchPool'
import { stepMorph } from '@/core/terrain/terrainMorph'
import { registerTerrainGroup, unregisterTerrainGroup } from '@/core/terrain/terrainDebug'
import {
  byBuildPriority,
  coverageReady,
  forEachWantedDescendant,
  liveAncestorKey,
  nodeKeyOf,
  selectTerrainNodes,
  terrainNodeKey,
  TERRAIN_QUADTREE_MAX_LEVEL,
  TERRAIN_QUADTREE_MIN_LEVEL,
  type TerrainLeaf,
  type TerrainNodeAddress
} from '@/core/terrain/terrainQuadtreeSelect'

/** Сводка пула патчей группы (dev-замер при спуске, см. __titanTerrain). */
export interface TerrainPatchStats {
  /** Занятые слоты пула (живые + запрошенные). */
  live: number
  /** Видимые меши. */
  visible: number
  pending: number
  /** Выделенные, но свободные слоты: видеопамять держат. */
  free: number
  maxLive: number
  valveScale: number
  /** Максимум live с создания или с последнего resetPeak(). */
  peakLive: number
  bytesPerSlot: number
  /** (live + free) × bytesPerSlot — видеопамять атрибутов пула. */
  liveBytes: number
  peakBytes: number
}

/** Мёртвая зона клапана: доли пула, в которых держится желаемый набор. */
export const VALVE_HIGH = 0.9
export const VALVE_LOW = 0.75
/** Шаг масштаба порога за кадр: вверх быстро, вниз медленно — оба мельче зоны. */
export const VALVE_RISE = 1.05
export const VALVE_FALL = 1.01
export const VALVE_MAX_SCALE = 8
/** Аварийный пол масштаба при полном пуле — рост от VALVE_LOW линейно до него. */
export const VALVE_EMERGENCY_SCALE = 4

/**
 * Клапан пула — интегральный регулятор масштаба порога сплита. Мерило —
 * размер желаемого набора, а не живые слоты: те включают переходные
 * (родитель и дети до свопа, pending), и мгновенная формула от них
 * замыкала петлю в предельный цикл с вечными пересборками. Без клапана
 * acquire()→null при полном пуле и освобождение по coverageReady
 * замыкались в тупик.
 *
 * Живые слоты дают аварийный пол, пока спрос выше зоны: пул заполняется
 * быстрее, чем масштаб растёт шагами. Пол поднимает масштаб сразу, вниз он
 * уходит лишь шагом VALVE_FALL; в зоне пола нет — мгновенного сброса, а с
 * ним и цикла, нет.
 */
export function nextValveScale(scale: number, wantedCount: number, maxLive: number, liveCount = 0): number {
  const overDemand = wantedCount > VALVE_HIGH * maxLive
  let next = scale
  if (overDemand) next = scale * VALVE_RISE
  else if (wantedCount < VALVE_LOW * maxLive) next = scale / VALVE_FALL

  const overfill = overDemand && maxLive > 0 ? (liveCount / maxLive - VALVE_LOW) / (1 - VALVE_LOW) : 0
  const floor = 1 + (VALVE_EMERGENCY_SCALE - 1) * Math.min(Math.max(overfill, 0), 1)

  return Math.min(Math.max(next, floor, 1), VALVE_MAX_SCALE)
}

/** Запрошенный, но не пришедший патч: слот уже захвачен, меша в сцене ещё нет. */
interface PendingEntry {
  handle: PatchHandle
  address: TerrainNodeAddress
  requestId: number
  initial: boolean
}

/** Живой патч в сцене: m — прогресс геоморфа (0 своя форма, 1 родительская), target — куда идёт. */
interface LiveEntry {
  handle: PatchHandle
  address: TerrainNodeAddress
  morph: number
  target: 0 | 1
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
 * Геоморф (флаг morph, terrain.lod.morphSeconds) поверх свопа: дети сплита
 * видимого узла ровно на уровень входят с m = 1 и спадают к своей форме;
 * дети мержа ровно на уровень растут к родительской до m = 1, лишь затем
 * своп. Патч в морфе не заменяется; через уровень — своп мгновенный, m = 0.
 *
 * patches делят один материал (аргумент конструктора) — контракт
 * ResourceObserver (.material на TerrainSphere) остаётся за наследником, эта
 * база сама его наружу не выставляет. RTC: вершины патча относительны его
 * центру, центр — в position меша.
 *
 * dispose() возвращает в пул слоты живых и запрошенных патчей (после него
 * приход результата ничего не пишет), освобождает пул (свободные слоты +
 * общий индекс) и живые меши (disposeSceneTree на каждый — геометрия/материал,
 * материал общий и dispose идемпотентен). Метод и есть тот самый Disposable,
 * которого при обходе сцены дожидается disposeSceneTree родителя — двойной dispose узлов,
 * уже освобождённых им напрямую, безвреден по тому же контракту.
 *
 * Геометрия патча несёт также detailPos/detailPos2 — домен детальных слоёв
 * (см. detailWrap.ts), периоды которого приходят сюда параметром detailWrap.
 */
abstract class TerrainPatchGroup extends Group {
  private readonly field: TerrainHeightField
  private readonly pool: TerrainPatchPool
  private readonly morphEnabled: boolean
  private readonly live = new Map<number, LiveEntry>()
  private readonly pending = new Map<number, PendingEntry>()
  /** Узлы, чья постройка упала: больше не запрашиваются (см. onPatchFailed). */
  private readonly failed = new Set<number>()
  // номер запроса — страховка от чужого прихода: сегодня запись из pending
  // снимают только приход и dispose
  private nextRequestId = 1
  private lastWanted: ReadonlyMap<number, TerrainLeaf> = new Map()
  private initialRemaining: number
  private readonly readyCallbacks: Array<() => void> = []
  private disposed = false
  private persistedSplit: ReadonlySet<number> = new Set()
  /** Масштаб порога сплита от клапана пула, см. nextValveScale. */
  private valveScale = 1
  private poolExhaustedWarned = false
  private peakLive = 0
  // замыкание переиспользуется между кадрами — coverageReady зовётся на каждый
  // освобождаемый узел, аллокация лямбды на вызов была бы мусором в горячем пути
  private readonly isLive = (key: number): boolean => this.live.has(key)
  // тот же приём, что isLive: колбэки forEachWantedDescendant зовутся на каждый
  // желаемый лист внутри освобождаемого узла — лямбда на вызов была бы мусором.
  // Флаги и параметры обхода — поля, а не локальные переменные, по той же
  // причине (замыкание на витке цикла освобождения было бы аллокацией).
  // descendantSeen — спуск нашёл желаемых потомков (узел дробится);
  // allDirect — все они прямые дети узла уровня inspectLevel
  private descendantSeen = false
  private allDirect = true
  private inspectLevel = 0
  private readonly inspectDescendant = (key: number): void => {
    this.descendantSeen = true
    if (this.lastWanted.get(key)?.level !== this.inspectLevel + 1) this.allDirect = false
  }
  /** m, с которым входит патч, ставший видимым в свопе. */
  private revealMorph = 0
  /**
   * Уровень скрытого освобождаемого узла, либо -1. Потомок под видимым живым
   * промежуточным узлом не показывается: тот ещё закрывает место и дробится
   * сам (в морфе — дождавшись m = 0), иначе — двойное покрытие.
   */
  private revealCoveredBelow = -1
  private readonly showLive = (key: number): void => {
    const entry = this.live.get(key)
    if (!entry || entry.handle.mesh.visible) return
    if (this.revealCoveredBelow >= 0 && this.visibleBetween(entry.address, this.revealCoveredBelow)) return
    entry.handle.mesh.visible = true
    this.resetMorph(entry, this.revealMorph)
  }

  // скретчи кадра: updateObject зовётся каждый кадр, аллокаций быть не должно
  private readonly cameraWorldScratch = new Vector3()
  private readonly viewProjScratch = new Matrix4()
  private readonly frustumScratch = new Frustum()

  protected constructor(
    field: TerrainHeightField,
    material: Material,
    protected readonly renderer: WebGLRenderer,
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
     * Строитель патчей: дефолт синхронный (постройка внутри запроса),
     * воркерный приходит от владельца.
     */
    protected readonly builder: TerrainPatchBuilder = new SyncTerrainPatchBuilder(),
    /**
     * Геоморф патчей (terrain.lod.morphSeconds): рельеф — да, вода — нет
     * (её пул без морф-атрибутов, задания с morph: null).
     */
    morph: boolean = false
  ) {
    super()
    this.field = field
    this.morphEnabled = morph
    this.pool = new TerrainPatchPool(material, TERRAIN_PATCH_SEGMENTS, maxLivePatches, morph)
    this.builder.acquire(field)
    registerTerrainGroup(this)

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

  /** Тип группы для dev-хендла: рельеф несёт морф-атрибуты, вода — нет. */
  public get debugKind(): 'terrain' | 'water' {
    return this.morphEnabled ? 'terrain' : 'water'
  }

  /** Сводка пула; зовётся редко (консоль), аллоцирует результат. */
  public stats(): TerrainPatchStats {
    let visible = 0
    for (const { handle } of this.live.values()) if (handle.mesh.visible) visible++

    const live = this.pool.liveCount
    const free = this.pool.freeCount
    const bytesPerSlot = this.pool.bytesPerSlot
    const peakLive = Math.max(this.peakLive, live)
    return {
      live,
      visible,
      pending: this.pending.size,
      free,
      maxLive: this.pool.maxLivePatches,
      valveScale: this.valveScale,
      peakLive,
      bytesPerSlot,
      liveBytes: (live + free) * bytesPerSlot,
      peakBytes: peakLive * bytesPerSlot
    }
  }

  public resetPeak(): void {
    this.peakLive = this.pool.liveCount
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
    if (!this.visible || this.parent?.visible === false) {
      this.onHiddenUpdate()

      return
    }

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
      splitPixels: config('terrain.sseSplitPixels') * this.valveScale,
      mergeFactor: config('terrain.sseMergeFactor'),
      currentlySplit: this.persistedSplit,
      waterLevelMeters: this.waterLevelMeters
    })
    this.persistedSplit = split
    this.valveScale = nextValveScale(this.valveScale, leaves.length, this.pool.maxLivePatches, this.pool.liveCount)

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
      if (this.live.has(key) || this.pending.has(key) || this.failed.has(key)) continue
      if (this.pending.size >= inFlightMax) break

      const elapsedMs = this.nowMs() - frameStart
      const builtHere = requested - this.pending.size
      if (builtHere > 0 && elapsedMs >= budgetMs) break

      if (!this.requestPatch(address, false)) continue
      requested++
    }

    // геоморф: шаг к цели прошлого кадра (желаемому — сразу к 0, иначе отмена
    // мержа лишний кадр росла бы); цели остальных ставит цикл освобождения
    const seconds = this.morphEnabled ? config('terrain.lod.morphSeconds') : 0
    for (const [key, entry] of this.live) {
      if (wanted.has(key)) entry.target = 0
      entry.morph = stepMorph(entry.morph, entry.target, ctx.delta, seconds)
      setPatchMorph(entry.handle, entry.morph)
    }

    // без дыр: показанный узел освобождается только когда готова его замена;
    // замена показывается в тот же кадр (атомарный своп): все живые потомки при
    // дроблении, живой предок — при схлопывании. Патч в морфе не заменяется:
    // сплит ждёт m = 0 у заменяемого, мерж — m = 1 у всех детей
    for (const [key, entry] of this.live) {
      if (wanted.has(key)) continue
      entry.target = 0
      if (!coverageReady(entry.address, wanted, this.isLive)) continue

      // ветки coverageReady взаимоисключающи: есть желаемые потомки ⇒ узел
      // дробится (все они живы), предок в этом случае не при чём
      this.descendantSeen = false
      this.allDirect = true
      this.inspectLevel = entry.address.level
      forEachWantedDescendant(entry.address, wanted, this.inspectDescendant)
      if (this.descendantSeen) {
        // морф — только сплит видимого узла ровно на уровень
        const morphSplit = seconds > 0 && entry.handle.mesh.visible && this.allDirect
        if (morphSplit && entry.morph > 0) continue // досматривает к своей форме
        this.revealMorph = morphSplit ? 1 : 0
        this.revealCoveredBelow = entry.handle.mesh.visible ? -1 : entry.address.level
        forEachWantedDescendant(entry.address, wanted, this.showLive)
        this.revealCoveredBelow = -1
      } else {
        const ancestor = liveAncestorKey(entry.address, this.isLive)
        if (ancestor !== -1 && wanted.has(ancestor)) {
          if (seconds > 0 && this.mergeWaits(entry, ancestor)) continue
          this.revealMorph = 0
          this.showLive(ancestor)
        }
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
      // предок мержа ждёт роста детей: его место закрыто четырьмя видимыми
      if (seconds > 0 && this.childrenVisible(entry.address)) continue
      entry.handle.mesh.visible = true
      this.resetMorph(entry, 0)
    }

    if (this.pool.liveCount > this.peakLive) this.peakLive = this.pool.liveCount
    this.pool.trimFree(Math.ceil(this.pool.liveCount / 4) + 16)
  }

  public dispose(): void {
    this.disposed = true
    unregisterTerrainGroup(this)
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
        wrap: this.detailWrap,
        // корень без родителя: нулевые дельты
        morph: this.morphEnabled ? address.level > TERRAIN_QUADTREE_MIN_LEVEL : null
      },
      (result) => this.onPatchBuilt(key, requestId, result),
      (error) => this.onPatchFailed(key, requestId, error)
    )

    return true
  }

  /**
   * Сбой постройки: слот назад в пул, узел больше не запрашивается — ядро мешера
   * детерминировано, повтор упал бы так же. Регион остаётся под живым родителем
   * (дыры нет, только грубее); сбой начального узла оставляет группу неготовой.
   */
  private onPatchFailed(key: number, requestId: number, error: unknown): void {
    if (this.disposed) return

    const entry = this.pending.get(key)
    if (!entry || entry.requestId !== requestId) return
    this.pending.delete(key)
    this.pool.release(entry.handle)
    this.failed.add(key)
    console.error(`[terrain] постройка патча упала, узел ${key} больше не запрашивается:`, error)
  }

  /**
   * Приход результата. Сверка requestId — страховка от чужого прихода: сегодня
   * запись pending снимают только приход и dispose. Узел, успевший выйти из
   * желаемого набора, отдаёт слот назад в пул. Постройка кадра входит
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
    const live: LiveEntry = { handle: entry.handle, address: entry.address, morph: 0, target: 0 }
    // слот из пула несёт m прошлого владельца
    this.resetMorph(live, 0)
    this.live.set(key, live)

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

  /** Новое начало морфа: m и спад к своей форме. */
  private resetMorph(entry: LiveEntry, m: number): void {
    entry.morph = m
    entry.target = 0
    setPatchMorph(entry.handle, m)
  }

  /**
   * Мерж ровно на уровень в скрытого готового предка: все четыре его ребёнка
   * живы и видимы — растут к родительской форме (цель 1), своп ждёт, пока
   * хоть один не дорос. Иначе (предок видим, через уровень, ребёнок скрыт
   * или раздроблен) — мгновенный своп, как без морфа.
   */
  private mergeWaits(entry: LiveEntry, ancestorKey: number): boolean {
    const ancestor = this.live.get(ancestorKey)
    if (!ancestor || ancestor.handle.mesh.visible || ancestor.address.level !== entry.address.level - 1) return false
    if (!this.childrenVisible(ancestor.address)) return false

    entry.target = 1
    const { face, level, i, j } = ancestor.address
    for (let di = 0; di < 2; di++) {
      for (let dj = 0; dj < 2; dj++) {
        if (this.live.get(nodeKeyOf(face, level + 1, 2 * i + di, 2 * j + dj))!.morph < 1) return true
      }
    }
    return false
  }

  /** Между узлом и уровнем topLevel (не включая) есть живой видимый предок. */
  private visibleBetween(address: TerrainNodeAddress, topLevel: number): boolean {
    for (let level = address.level - 1; level > topLevel; level--) {
      const delta = address.level - level
      const entry = this.live.get(nodeKeyOf(address.face, level, address.i >> delta, address.j >> delta))
      if (entry?.handle.mesh.visible) return true
    }
    return false
  }

  /** Все четыре прямых ребёнка узла живы и видимы. */
  private childrenVisible(address: TerrainNodeAddress): boolean {
    const { face, level, i, j } = address
    if (level >= TERRAIN_QUADTREE_MAX_LEVEL) return false
    for (let di = 0; di < 2; di++) {
      for (let dj = 0; dj < 2; dj++) {
        const child = this.live.get(nodeKeyOf(face, level + 1, 2 * i + di, 2 * j + dj))
        if (!child || !child.handle.mesh.visible) return false
      }
    }
    return true
  }

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

  /** Зовётся каждый кадр, пока группа или её родитель скрыты: потомок освобождает то, что нужно только видимому телу. Без аллокаций. */
  protected onHiddenUpdate(): void {}

  private warnPoolExhausted(): void {
    if (this.poolExhaustedWarned) return
    console.warn('[TerrainPatchGroup] пул патчей исчерпан — деталь ограничена')
    this.poolExhaustedWarned = true
  }

}

export { TerrainPatchGroup }
