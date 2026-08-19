import type { Scene } from 'three'
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
    private factory: RenderableFactory
  ) {
    this.sceneObserver.subscribe('ClosestChange', this.onClosestChange)
  }

  public dispose(): void {
    this.sceneObserver.unsubscribe('ClosestChange', this.onClosestChange)
  }

  public recompute(): void {
    const candidates: HeightMapCandidate[] = []
    const nodeByPath: Map<string, DynamicNode> = new Map()

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
      nodeByPath.set(path, node)
    }

    const decision = decideHeightMaps(
      candidates,
      heightFieldStorage.heldPaths(),
      minBodyPixelsToPriorityThreshold(config('terrain.heightMapLoadPixels')),
      minBodyPixelsToPriorityThreshold(config('terrain.heightMapReleasePixels'))
    )

    for (const path of decision.request) heightFieldStorage.request(path)

    for (const path of decision.release) {
      // Даунгрейд до release: узел обязан отцепиться от поля высот раньше,
      // чем карта уйдёт из реестра, иначе TerrainSphere осталась бы стоять
      // на данных, которых уже нет.
      const node: DynamicNode | undefined = nodeByPath.get(path)

      if (node) this.factory.downgradeTerrainToPlanet(node)

      heightFieldStorage.release(path)
    }

    // Апгрейд тех, чьи карты уже доехали: приход асинхронен и никого не
    // будит, поэтому проверка на каждом пересчёте.
    for (const [path, node] of nodeByPath) {
      if (heightFieldStorage.get(path)) this.factory.upgradePlanetToTerrain(node)
    }
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
