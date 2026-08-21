import type { Scene, WebGLRenderer } from 'three'
import type { Actor } from '@/core/models/Actor'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { minBodyPixelsToPriorityThreshold } from '@/core/streaming/angularCutoff'
import { decideHeightMaps, type HeightMapCandidate } from '@/core/terrain/heightMapGatePolicy'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import type { RenderableFactory } from '@/core/renderables/RenderableFactory'
import type { ObservableRecord, SceneObserver } from '@/core/services/SceneObserver'

/** Защита от деления на ноль, когда камера стоит ровно в центре тела. */
const MIN_DISTANCE: number = 1e-9

/**
 * Решает, чьи карты высот держать в памяти. Отдельным сервисом, а не веткой
 * ResourceObserver: тот занят видеопамятью и текстурным конвейером, а карты
 * высот — JS-heap, свой жизненный цикл и свои пороги.
 *
 * Подписан на ClosestChange — тот же источник, что у стримера текстур, а
 * значит работает и от движения камеры, и от периодического тика
 * SceneObserver, даже когда камера стоит, а тела движутся по орбитам.
 *
 * Апгрейд узла делается опросом, а не колбэком завершения загрузки: реестр
 * не обещает промис, а пересчёт и так идёт дважды в секунду. Обе операции
 * фабрики идемпотентны, так что лишний вызов стоит поиска по имени и
 * instanceof.
 */
export class HeightFieldGate {
  public constructor(
    private sceneObserver: SceneObserver,
    private scene: Scene,
    private factory: RenderableFactory,
    private renderer: WebGLRenderer
  ) {
    this.sceneObserver.subscribe('ClosestChange', this.onClosestChange)
  }

  /**
   * ТОЛЬКО ДЛЯ ТЕСТОВ — из продакшена звать нельзя. Подписка на
   * `ClosestChange` ставится в конструкторе синглтона контейнера, который
   * строится один раз за сессию и при входе в новый сценарий не
   * пересоздаётся: снятая здесь подписка не восстанавливается НИКОГДА, и
   * вызов тихо выключил бы гейт карт высот до конца сессии — тела остались бы
   * на легаси-сферах навсегда, без единой ошибки в консоли. Ровно та же
   * оговорка, что у `SceneObserver.dispose` про самоподписку из конструктора.
   * Продакшен-вызовов сегодня нет; метод живёт ради изоляции тестов
   * (`tests/services/HeightFieldGate.spec.ts`), которым нужно снять подписку
   * стенда со сцены.
   */
  public dispose(): void {
    this.sceneObserver.unsubscribe('ClosestChange', this.onClosestChange)
  }

  public recompute(): void {
    const candidates: HeightMapCandidate[] = []
    // Путь → ВСЕ узлы, которые его просят: одна карта высот легально шарится
    // несколькими телами (политика схлопывает дубли пути по максимуму
    // приоритета, а terrainHeightFieldFor кэширует поле по паре «карта +
    // радиус» именно ради вымышленных лун разных радиусов на общей карте).
    // Одиночным значением последний кандидат затирал бы предыдущих, и все,
    // кроме него, застряли бы на легаси-сфере навсегда: апгрейд узла просто
    // никогда бы не вызвался.
    const nodesByPath: Map<string, DynamicNode[]> = new Map()
    // Растёт в true, если апгрейд/даунгрейд ХОТЯ БЫ РАЗ реально подменил
    // поверхность узла (обе операции фабрики возвращают это булем). Триггерит
    // единственный пересбор снимка наблюдения в конце — см. докблок ниже.
    let surfaceSwapped: boolean = false

    for (const record of this.sceneObserver.data.values()) {
      // Актор берётся из узла, а не поиском по имени в ORM: имена в БД не
      // уникальны (у планеты и её атмосферы одна строка name), и Actor.first
      // по имени вернул бы для Земли атмосферный слой без physicalObject.
      // node.model — тот самый актор, из которого узел и построен.
      const node: DynamicNode | undefined = this.findNode(record.name)

      if (!node) continue

      const path: string | undefined = heightPathOf(node.model)

      if (!path) continue

      candidates.push({ path, actorPriority: this.priorityOf(node.model, record) })

      const shared: DynamicNode[] | undefined = nodesByPath.get(path)

      if (shared) shared.push(node)
      else nodesByPath.set(path, [node])
    }

    // Пороги — в ЖИВЫХ пикселях канваса, не в номинальных 1080p стримера:
    // обещание «карта приедет к такому-то размеру тела на экране» обязано
    // выполняться на том экране, который у пользователя, и мериться так же,
    // как меряет размер SSE-отбор того же террейна (см. angularCutoff)
    const fovDegrees: number = config('camera.fov')
    const viewportHeight: number = this.renderer.domElement.height

    const decision = decideHeightMaps(
      candidates,
      heightFieldStorage.heldPaths(),
      minBodyPixelsToPriorityThreshold(config('terrain.heightMapLoadPixels'), fovDegrees, viewportHeight),
      minBodyPixelsToPriorityThreshold(config('terrain.heightMapReleasePixels'), fovDegrees, viewportHeight),
      (path: string): number | undefined => heightFieldStorage.bytesOf(path),
      config('terrain.heightMapBudgetMiB') * 1024 * 1024
    )

    for (const path of decision.request) heightFieldStorage.request(path)

    for (const path of decision.release) {
      // Даунгрейд до release: узел обязан отцепиться от поля высот раньше,
      // чем карта уйдёт из реестра, иначе TerrainSphere осталась бы стоять
      // на данных, которых уже нет.
      for (const node of nodesByPath.get(path) ?? []) {
        if (this.factory.downgradeTerrainToPlanet(node)) surfaceSwapped = true
      }

      heightFieldStorage.release(path)
    }

    // Апгрейд тех, чьи карты уже доехали: приход асинхронен и никого не
    // будит, поэтому проверка на каждом пересчёте.
    for (const [path, nodes] of nodesByPath) {
      if (!heightFieldStorage.get(path)) continue

      for (const node of nodes) {
        if (this.factory.upgradePlanetToTerrain(node)) surfaceSwapped = true
      }
    }

    // Один пересбор на весь пересчёт, а не по разу на тело: userData.type
    // висит на самой поверхности (Planet/TerrainSphere), а не на DynamicNode
    // — swapSurface открепляет старую поверхность от узла и диспоузит её, и
    // старый снимок SceneObserver.objects продолжал бы держать её ссылку
    // (getWorldPosition открепленного объекта схлопывается в начало
    // координат, дистанция до тела превращается в дистанцию до центра
    // системы — ломает ближайшее тело, стример, переход камеры и сам гейт).
    // CameraCollision.refreshColliders сравнивает ссылку sceneObserver.objects
    // — пересбор чинит и коллизию тем же ходом.
    if (surfaceSwapped) this.sceneObserver.refreshObservableObjects()
  }

  private onClosestChange = (): void => {
    this.recompute()
  }

  /**
   * Угловой приоритет — та же величина, что у стримера текстур
   * (радиус в юнитах / дистанция): пороги в пикселях переводятся в неё
   * через minBodyPixelsToPriorityThreshold.
   */
  private priorityOf(actor: Actor, record: ObservableRecord): number {
    const radiusKm: number = actor.physicalObject?.getAttribute('radius', 0) ?? 0

    return toThreeJSUnits(radiusKm) / Math.max(record.distance, MIN_DISTANCE)
  }

  /**
   * Узел тела по имени. getObjectByName идёт в глубину от корня, поэтому
   * DynamicNode планеты находится раньше своих детей; instanceof отсекает
   * одноимённые атмосферу и уровни LOD.
   */
  private findNode(name: string): DynamicNode | undefined {
    const found = this.scene.getObjectByName(name)

    return found instanceof DynamicNode ? found : undefined
  }
}
