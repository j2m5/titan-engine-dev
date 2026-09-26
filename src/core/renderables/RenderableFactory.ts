import { LOD, Object3D, WebGLRenderer } from 'three'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'
import { Actor } from '@/core/models/Actor'
import { Barycenter } from '@/core/renderables/Barycenter'
import { BlackHole } from '@/core/renderables/BlackHole'
import { BlackHoleImpostor } from '@/core/renderables/BlackHole/BlackHoleImpostor'
import { BlackHoleLod } from '@/core/renderables/utils/BlackHoleLod'
import { StaticNode } from '@/core/renderables/utils/StaticNode'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { Star } from '@/core/renderables/Star'
import { StarInnerLayer } from '@/core/renderables/utils/StarInnerLayer'
import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { StarLod } from '@/core/renderables/utils/StarLod'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { Planet } from '@/core/renderables/Planet'
import { TerrainSphere, assertProceduralWiring } from '@/core/renderables/TerrainSphere'
import { WaterSphere } from '@/core/renderables/Water/WaterSphere'
import { FakePlanet } from '@/core/renderables/utils/FakePlanet'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { terrainHeightFieldFor } from '@/core/terrain/TerrainHeightField'
import { midbandParamsOf } from '@/core/terrain/midbandParams'
import { heightPathOf } from '@/core/terrain/heightPath'
import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { Ring } from '@/core/renderables/Ring'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { shapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import { degToRad } from 'three/src/math/MathUtils'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { readRenderingData, requireRenderingData } from '@/core/helpers/renderingData'
import { readWaterLevelMeters } from '@/core/terrain/waterLevel'
import {
  BROWN_DWARF_IMPOSTOR_PIXELS,
  GIANT_STAR_IMPOSTOR_PIXELS,
  WHITE_DWARF_IMPOSTOR_PIXELS
} from '@/core/helpers/apparentSize'
import { Nebula } from '@/core/renderables/Nebula'
import { nebulaParamsFromData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { BrownDwarf } from '@/core/renderables/BrownDwarf'
import { BrownDwarfImpostor } from '@/core/renderables/BrownDwarf/BrownDwarfImpostor'
import { WhiteDwarf } from '@/core/renderables/WhiteDwarf/WhiteDwarf'
import { WhiteDwarfImpostor } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostor'
import { pulsarParameters } from '@/core/renderables/Pulsar/PulsarParameters'
import { PulsarBeams } from '@/core/renderables/Pulsar/PulsarBeams'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { GiantStar, GiantStarImpostor, GiantStarShell } from '@/core/renderables/GiantStar'
import { INebulaRenderingObject, IPlanetRenderingObject, IRingRenderingObject } from '@/core/models/types'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import type { ProceduralSurfaceGenerator } from '@/core/services/ProceduralSurfaceGenerator'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import type { LensRegistry } from '@/core/services/LensRegistry'
import { RenderableObject3D } from '@/core/renderables/types'
import { syncRenderableMaterials } from '@/core/materials/materialSync'
import { SyncTerrainPatchBuilder, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'

class RenderableFactory {
  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly resourceObserver: ResourceObserver,
    private readonly atmosphereRegistry: AtmosphereRegistry,
    private readonly depthVolumeRegistry: DepthVolumeRegistry,
    // Опционален: тестовые сборки фабрики без процедурных тел его не заводят
    // (см. TerrainSphere — тот же гейт по data.proceduralSurface, no-op без него).
    private readonly proceduralSurfaceGenerator?: ProceduralSurfaceGenerator,
    /** Строитель патчей рельефа: дефолт синхронный (постройка внутри запроса), воркерный — от контейнера. */
    private readonly terrainPatchBuilder: TerrainPatchBuilder = new SyncTerrainPatchBuilder(),
    /**
     * Пересбор снимка наблюдения после свапа ВНЕ тика гейта (свап по
     * готовности начального набора). Свапы внутри тика пересобирает сам
     * HeightFieldGate по возврату true — здесь возврата нет, звать некому.
     */
    private readonly refreshObservation: () => void = () => {},
    /** Реестр гравитационных линз для экранного прохода дальнего поля; без него дыра лензирует только внутри меша */
    private readonly lensRegistry: LensRegistry | null = null
  ) {}

  /** Узлы, чей рельеф построен не до конца: легаси-сфера на экране, свап ждёт готовности. */
  private readonly pendingUpgrades = new Map<DynamicNode, TerrainSphere>()

  public make(actor: Actor): Object3D {
    switch (actor.getAttribute('categoryId', -1)) {
      case 1:
        return this.createBarycenter(actor)
      case 2:
        return this.createBlackHole(actor)
      case 3:
        return this.createStar(actor)
      case 4:
        return this.createPlanet(actor)
      case 5:
        return this.createAtmosphere(actor)
      case 6:
        return this.createRing(actor)
      case 7:
        return this.createNebula(actor)
      case 8:
        return this.createBrownDwarf(actor)
      case 9:
        return this.createWhiteDwarf(actor)
      case 10:
        return this.createGiantStar(actor)
      case 11:
        return this.createAsteroidBelt(actor)
      case 12:
        return this.createPulsar(actor)
      default:
        throw new Error("Couldn't resolve actor")
    }
  }

  private createBarycenter(actor: Actor): Object3D {
    return new Barycenter(actor)
  }

  private createBlackHole(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lodl1 = new BlackHole(actor, this.resourceObserver, this.lensRegistry)
    const lodl2 = new BlackHoleImpostor(actor, lodl1.parameters, this.renderer)
    const lod = new BlackHoleLod(lodl1.parameters.simulationRadius, this.renderer)

    node.name = actor.getAttribute('name', '')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name', '') + 'LOD'

    // Стартовое значение: дальше BlackHoleLod пересчитывает дистанцию каждый
    // кадр — порог задан в пикселях и обязан переживать ресайз и смену fov
    lod.addLevel(lodl1)
    lod.addLevel(lodl2, lod.switchDistance(config('camera.fov')), config('blackHole.lodHysteresis'))

    node.add(lod)

    return node
  }

  private createStar(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new StarLod(actor.physicalObject!.getAttribute('radius')!, this.renderer)
    const lodl1 = new Star(actor)
    const lodl2 = new FakeStar(actor, this.renderer)
    const starInnerLayer = new StarInnerLayer(actor)
    const starOuterLayer = new StarOuterLayer(actor)

    lod.add(starInnerLayer)
    lodl1.add(starOuterLayer)

    node.name = actor.getAttribute('name', '')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name', '') + 'LOD'

    // Стартовое значение: дальше StarLod пересчитывает дистанцию каждый кадр,
    // потому что билборд меряет свой размер живой высотой вьюпорта
    lod.addLevel(lodl1)
    // Гистерезис против мигания на границе: обратное переключение на
    // d·(1−h), диск возвращается на ~12.6px вместо 12 (см. config/star.ts)
    lod.addLevel(lodl2, lod.switchDistance(config('camera.fov')), config('star.lodHysteresis'))

    node.add(lod)

    return node
  }

  private createBrownDwarf(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new ApparentSizeLod(
      actor.physicalObject!.getAttribute('radius')!,
      this.renderer,
      BROWN_DWARF_IMPOSTOR_PIXELS
    )
    const body = new BrownDwarf(actor)
    const impostor = new BrownDwarfImpostor(body, this.renderer)

    // Ореол висит на LOD, а не на теле: он нужен на обоих уровнях, и
    // сильнее всего именно на дальнем, где тело меньше пикселя.
    // Приглушён против звёздного — карлик тлеет, а не сияет
    lod.add(new StarInnerLayer(actor, 0.8, config('brownDwarf.haloOpacity')))

    node.name = actor.getAttribute('name', '')
    node.renderable = body

    lod.name = actor.getAttribute('name', '') + 'LOD'
    lod.addLevel(body)
    lod.addLevel(impostor, lod.switchDistance(config('camera.fov')), config('brownDwarf.lodHysteresis'))

    node.add(lod)

    return node
  }

  private createWhiteDwarf(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new ApparentSizeLod(
      actor.physicalObject!.getAttribute('radius')!,
      this.renderer,
      WHITE_DWARF_IMPOSTOR_PIXELS
    )
    const body = new WhiteDwarf(actor)
    const impostor = new WhiteDwarfImpostor(body, this.renderer)

    // Ореол висит на LOD, а не на теле: он нужен на обоих уровнях, и сильнее
    // всего на дальнем. У карлика это не украшение — при угловом размере в
    // сотню раз меньше солнечного тело почти всегда мельче пикселя, и весь
    // его вид несёт ореол. Отсюда opacity выше звёздной при меньшем масштабе:
    // жёсткая искра, а не раздутая корона, которой у карлика нет физически
    lod.add(new StarInnerLayer(actor, config('whiteDwarf.haloScale'), config('whiteDwarf.haloOpacity')))

    node.name = actor.getAttribute('name', '')
    node.renderable = body

    lod.name = actor.getAttribute('name', '') + 'LOD'
    lod.addLevel(body)
    lod.addLevel(impostor, lod.switchDistance(config('camera.fov')), config('whiteDwarf.lodHysteresis'))

    node.add(lod)

    return node
  }

  /**
   * Пульсар: точка с гало — те же тело и импостор, что у белого карлика
   * (сотни тысяч кельвинов дают тот же бело-голубой цвет, радиус 10 км —
   * всегда точка); поверх — объём лучей-маяка, ребёнок узла, не LOD: лучи
   * видны на любой дистанции. Кватернион лучей — полюс оси вращения.
   */
  private createPulsar(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new ApparentSizeLod(actor.physicalObject!.getAttribute('radius')!, this.renderer, WHITE_DWARF_IMPOSTOR_PIXELS)
    const body = new WhiteDwarf(actor)
    const impostor = new WhiteDwarfImpostor(body, this.renderer)

    lod.add(new StarInnerLayer(actor, config('pulsar.haloScale'), config('pulsar.haloOpacity')))

    node.name = actor.getAttribute('name', '')
    node.renderable = body

    lod.name = actor.getAttribute('name', '') + 'LOD'
    lod.addLevel(body)
    lod.addLevel(impostor, lod.switchDistance(config('camera.fov')), config('pulsar.lodHysteresis'))
    node.add(lod)

    const params = pulsarParameters(actor)
    if (params.beamIntensity > 0) {
      const beams = new PulsarBeams(params, this.depthVolumeRegistry)
      beams.name = actor.getAttribute('name', '') + 'Beams'
      beams.quaternion.copy(new OrientationModel(actor).getPoleQuaternion())
      node.add(beams)
    }

    return node
  }

  private createGiantStar(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new ApparentSizeLod(
      actor.physicalObject!.getAttribute('radius')!,
      this.renderer,
      GIANT_STAR_IMPOSTOR_PIXELS
    )
    const body = new GiantStar(actor)
    const shell = new GiantStarShell(body)
    const impostor = new GiantStarImpostor(body, shell, this.renderer)

    // Оболочка — дочь тела: переключается LOD'ом вместе с ним. Протуберанцев
    // (StarOuterLayer) нет намеренно — гиганту они не свойственны
    body.add(shell)

    // Ореол на LOD, а не на теле: нужен на обоих уровнях
    lod.add(new StarInnerLayer(actor, config('giantStar.haloScale'), config('giantStar.haloOpacity')))

    node.name = actor.getAttribute('name', '')
    node.renderable = body

    lod.name = actor.getAttribute('name', '') + 'LOD'
    lod.addLevel(body)
    lod.addLevel(impostor, lod.switchDistance(config('camera.fov')), config('giantStar.lodHysteresis'))

    node.add(lod)

    return node
  }

  /**
   * Нулевой уровень LOD планеты: рельеф, если карта высот уже в реестре,
   * иначе легаси-сфера. Общий для createPlanet и апгрейда/даунгрейда —
   * иначе связка «рельеф + водная оболочка» существовала бы в двух копиях
   * и разъехалась бы на первой же правке.
   */
  private buildPlanetSurface(actor: Actor): RenderableObject3D {
    const heightPath: string | undefined = heightPathOf(actor)
    const heightMap = heightPath ? heightFieldStorage.get(heightPath) : undefined

    if (!heightMap) {
      // легаси-сфера живёт до прихода карты высот (и навсегда, если карта не пришла):
      // процедурный диффуз нужен ей так же, как TerrainSphere
      assertProceduralWiring(actor, this.proceduralSurfaceGenerator)
      if (this.proceduralSurfaceGenerator && readRenderingData<IPlanetRenderingObject>(actor)?.proceduralSurface) {
        this.proceduralSurfaceGenerator.ensureDiffuse(actor)
      }

      return new Planet(actor, this.atmosphereRegistry)
    }

    const terrain = new TerrainSphere(
      actor,
      // одна функция чтения параметров полосы с CameraCollision — иначе
      // кеш terrainHeightFieldFor разойдётся на два поля одной карты и
      // мешер с коллизией разъедутся (урок архива этапа 5)
      terrainHeightFieldFor(heightMap, actor.physicalObject!.getAttribute('radius')!, midbandParamsOf(actor)),
      this.renderer,
      this.atmosphereRegistry,
      this.proceduralSurfaceGenerator,
      undefined,
      this.terrainPatchBuilder
    )

    // Гейт водной оболочки: обе ручки разом — карта высот (без неё нет
    // рельефа, отделять воду не от чего) И waterLevelMeters в data. Вода
    // висит на TerrainSphere ребёнком, не отдельным уровнем LOD: делит с ней
    // видимость (LOD прячет и рельеф, и воду одним переключением), см.
    // докблок WaterSphere. Предикат валидности ручки — readWaterLevelMeters,
    // единый на все места чтения, включая коллизию и SSE-отбор.
    const waterLevelMeters = readWaterLevelMeters(actor)

    // Кубмапа фона (арка water-shader, Task 2) — та же текстура, что рисует
    // SkyboxBackground/BlackHole, ЖЕ доступна фабрике (resourceObserver уже
    // конструкторный аргумент, отдельного реестра заводить не нужно): к
    // моменту создания WaterSphere сценарий уже прогрузился (Application.run
    // ждёт loadPrimaryTextures до SceneManager.initialize, см. докблок
    // WaterMaterial конструктора) — sceneBackground либо готов, либо честно
    // null (сценарий без фона).
    if (waterLevelMeters !== undefined) {
      terrain.add(
        new WaterSphere(
          actor,
          waterLevelMeters,
          this.renderer,
          this.resourceObserver.sceneBackground,
          this.atmosphereRegistry
        )
      )
    }

    return terrain
  }

  /**
   * Меняет нулевой уровень LOD на месте. Уровень, а не весь узел: пересоздание
   * DynamicNode оборвало бы орбитальную линию, экваториальную рамку с кольцами
   * и атмосферой и ссылки наблюдателей по имени.
   *
   * addLevel здесь непригоден — он добавил бы ВТОРОЙ уровень с той же
   * дистанцией; правится сам элемент levels[0].
   *
   * Материал новой поверхности синхронизируется с уже загруженными текстурами
   * тела в конце (см. докблок syncRenderableMaterials): конструктор
   * PlanetMaterial сажает в юниформы плейсхолдеры, а ResourceObserver зовёт
   * updateMaterial только по СВОИМ поводам (загрузка пути, вытеснение пути,
   * догон нового владельца) — свап ни одним из них не является, владелец и
   * пути те же. Без этого шага апгрейднутое тело теряло бы диффуз, night,
   * cloud, specular и slope, давно лежащие в resourceStorage: угловая отсечка
   * стримера (4 px) на порядок мягче порога гейта карт высот (32 px), так что
   * к моменту свапа они гарантированно загружены и повторно не приедут.
   *
   * Порядок в гейте на даунгрейде — сначала свап, потом
   * heightFieldStorage.release: синхронизация видит карту высот ещё в реестре
   * и на один тик оставляет легаси-сфере рельефные дефайны (USE_TERRAIN_UV
   * даёт ровно ту же равнопрямоугольную развёртку, что вершинный vUv сферы,
   * см. TerrainUv), а отсутствующий у сферы атрибут patchCenter закрыт
   * дефолтом материала (см. defaultAttributeValues в PlanetMaterial).
   * Окно закрывает сам гейт — resyncSurfaceMaterials сразу после release
   * (в окне живёт диспознутая release'ом карта тени рельефа);
   * менять порядок в гейте нельзя — узел обязан отцепиться от поля высот
   * раньше, чем данные уйдут из реестра.
   */
  private swapSurface(node: DynamicNode, next: RenderableObject3D): void {
    const lod = node.children.find((child): child is LOD => child instanceof LOD)

    if (!lod || !lod.levels.length) return

    const previous: Object3D = lod.levels[0].object

    lod.remove(previous)
    lod.levels[0].object = next
    lod.add(next)
    node.renderable = next

    disposeSceneTree(previous)
    syncRenderableMaterials(next)
  }

  /**
   * Карта высот доехала — тело переходит с легаси-сферы на рельеф.
   * Идемпотентен: гейт (Task 5) зовёт его на каждом пересчёте, пока тело
   * близко, но только когда карта уже лежит в реестре — холостых вызовов
   * без карты в горячем пути сегодня нет.
   *
   * Наличие карты проверяется ДО постройки поверхности: без карты
   * buildPlanetSurface всё равно вернул бы легаси Planet (SphereGeometry
   * 256×256 + PlanetMaterial), который тут же ушёл бы в мусор проверкой
   * ниже — тяжёлая аллокация ради значения, которое немедленно выбрасывается.
   *
   * Возвращает true ТОЛЬКО если свап случился в этом вызове. При асинхронном
   * строителе начальный набор патчей строится вне кадра, и до его готовности
   * возврат false: легаси-сфера остаётся на экране (подлёт без заминки и без
   * дыр), свап делает whenReady. Повторный вызов на ждущем узле — no-op,
   * второй поверхности не строит.
   */
  public upgradePlanetToTerrain(node: DynamicNode): boolean {
    const lod = node.children.find((child): child is LOD => child instanceof LOD)

    if (!lod || !lod.levels.length) return false
    if (lod.levels[0].object instanceof TerrainSphere) return false
    if (this.pendingUpgrades.has(node)) return false

    const heightPath: string | undefined = heightPathOf(node.model)
    // идентичность, а не наличие: поздняя готовность сверяет с ней карту в реестре
    const heightMap = heightPath ? heightFieldStorage.get(heightPath) : undefined

    if (!heightPath || !heightMap) return false

    // Карта в реестре подтверждена выше — buildPlanetSurface заведомо
    // вернёт TerrainSphere.
    const surface: RenderableObject3D = this.buildPlanetSurface(node.model)

    if (!(surface instanceof TerrainSphere) || surface.ready) {
      this.swapSurface(node, surface)

      return true
    }

    const legacy: Object3D = lod.levels[0].object

    this.pendingUpgrades.set(node, surface)
    surface.whenReady((): void => {
      // страховка: отменённый апгрейд (даунгрейд, разборка сценария) сюда не
      // доходит — задиспоженная группа готовность не объявляет
      if (this.pendingUpgrades.get(node) !== surface) return

      this.pendingUpgrades.delete(node)

      // уровень заменён мимо фабрики или карта выгружена либо перезагружена без
      // даунгрейда: свап попал бы в разобранный LOD или на поле чужой карты
      if (lod.levels.at(0)?.object !== legacy || heightFieldStorage.get(heightPath) !== heightMap) {
        disposeSceneTree(surface)

        return
      }

      this.swapSurface(node, surface)
      this.refreshObservation()
    })

    return false
  }

  /**
   * Разборка ждущих апгрейдов при смене сценария. Отсоединённые сферы не входят
   * в граф сцены, и engine.dispose() их не разбирает: слоты пула и регистрацию
   * поля у строителя отпускает только их собственный dispose.
   */
  public clearPendingUpgrades(): void {
    const surfaces: TerrainSphere[] = [...this.pendingUpgrades.values()]

    this.pendingUpgrades.clear()

    for (const surface of surfaces) disposeSceneTree(surface)
  }

  /** Узел ждёт готовности начального набора: апгрейд запрошен, свапа ещё не было. */
  public hasPendingUpgrade(node: DynamicNode): boolean {
    return this.pendingUpgrades.has(node)
  }

  /**
   * Повторная синхронизация материалов текущей поверхности узла — гейт зовёт
   * её на даунгрейднутых узлах сразу ПОСЛЕ heightFieldStorage.release.
   * Синхронизация внутри свапа идёт при карте, ещё лежащей в реестре, и сажает
   * в юниформ GL-текстуру тени рельефа, которую release тут же диспозит; второй
   * проход видит пустой реестр, снимает рельефные дефайны и обнуляет юниформ.
   * Без карты в реестре холостая — никаких повторных загрузок не вызывает.
   */
  public resyncSurfaceMaterials(node: DynamicNode): void {
    if (node.renderable) syncRenderableMaterials(node.renderable)
  }

  /**
   * Карта отпущена — тело возвращается на легаси-сферу. Идемпотентен.
   *
   * Ждущий апгрейд отменяется здесь же: свапа ещё не было, легаси-сфера и так
   * на экране, поэтому возврат false (менять в снимке наблюдения нечего).
   * Недостроенная TerrainSphere разбирается — pending-слоты пула и ссылку на
   * поле высот отпускает её dispose (TerrainPatchGroup), приходы патчей после
   * него тихо отбрасываются.
   */
  public downgradeTerrainToPlanet(node: DynamicNode): boolean {
    const pendingSurface: TerrainSphere | undefined = this.pendingUpgrades.get(node)

    if (pendingSurface) {
      this.pendingUpgrades.delete(node)
      disposeSceneTree(pendingSurface)

      return false
    }

    const lod = node.children.find((child): child is LOD => child instanceof LOD)

    if (!lod || !lod.levels.length) return false
    if (!(lod.levels[0].object instanceof TerrainSphere)) return false

    this.swapSurface(node, new Planet(node.model, this.atmosphereRegistry))

    return true
  }

  private createPlanet(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    const lodl1: RenderableObject3D = this.buildPlanetSurface(actor)
    const lodl2 = new FakePlanet(actor)

    // Известно-неверная высота кадра: tan(fov) вместо 2*tan(fov/2), поэтому
    // переключение происходит на 3.8 px вместо номинальных 3. Не тронута
    // намеренно — честная правка отодвинула бы переключение на 28% дальше и
    // требует замера кадра. У ЧД это уже вылечено (BlackHoleLod + пересчёт
    // lodPixels под фактический порог) — тот же приём применим и здесь
    const distanceLod = (pixels: number): number => {
      const radius: number = actor.physicalObject!.getAttribute('radius')!
      const fov: number = degToRad(config('camera.fov'))

      return toThreeJSUnits((2 * radius * this.renderer.domElement.height) / (Math.tan(fov) * pixels))
    }

    node.name = actor.getAttribute('name', '')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name', '') + 'LOD'

    lod.addLevel(lodl1)
    lod.addLevel(lodl2, distanceLod(3))

    node.add(lod)

    return node
  }

  private createAtmosphere(actor: Actor): Object3D {
    return new BrunetonAtmosphere(actor, this.renderer, this.atmosphereRegistry)
  }

  private createRing(actor: Actor): Object3D {
    // Проверка стоит до конструирования: кольцо без конфига не построить, и отказ здесь
    // ничего не аллоцирует, а сужение дальше доказывает сам tsc
    const ringData: IRingRenderingObject = requireRenderingData<IRingRenderingObject>(
      actor,
      'RenderableFactory',
      'кольца'
    )

    const node = new StaticNode(actor)
    const lod = new LOD()
    const base = new Ring(actor)
    const detailed = new Ring(actor)
    detailed.add(new AsteroidRingSystem(actor, {}, this.depthVolumeRegistry, shapeModelStorage))

    const distanceLod = toThreeJSUnits(ringData.outerRadius * 2)

    node.name = actor.getAttribute('name', '') + 'Ring'
    lod.name = actor.getAttribute('name', '') + 'Ring'
    node.renderable = base

    lod.addLevel(detailed)
    lod.addLevel(base, distanceLod)

    node.add(lod)

    return node
  }

  private createNebula(actor: Actor): Object3D {
    // Как и у кольца: проверка до конструирования — туманность без конфига
    // не построить, отказ здесь ничего не аллоцирует
    const data: INebulaRenderingObject = requireRenderingData<INebulaRenderingObject>(
      actor,
      'RenderableFactory',
      'туманности'
    )

    const node = new PlacedNode(actor)

    node.name = actor.getAttribute('name', '')
    // renderable намеренно остаётся null: Nebula — контейнер без собственных
    // geometry/material, а RenderableObject3D требует оба. Следствие —
    // у туманности нет маркера и прицела, она не навигационное тело.
    node.add(new Nebula(this.renderer, nebulaParamsFromData(data), this.depthVolumeRegistry))

    return node
  }

  private createAsteroidBelt(actor: Actor): Object3D {
    const node = new PlacedNode(actor)

    node.name = actor.getAttribute('name', '')
    // renderable намеренно null: как у туманности, пояс — Group-контейнер без
    // собственных geometry/material, маркера и прицела у него нет
    node.add(new AsteroidBelt(actor, this.depthVolumeRegistry))

    return node
  }
}

export { RenderableFactory }
