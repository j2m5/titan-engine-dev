import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Scene } from 'three'
import type { LeakDetector } from '@/core/lifecycle/LeakDetector'
import type { HeightFieldGate } from '@/core/services/HeightFieldGate'
import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'

class Application {
  private everLoaded: boolean = false

  public constructor(
    private engine: Engine,
    private resourceObserver: ResourceObserver,
    private scene: Scene,
    private leakDetector: LeakDetector,
    private heightFieldGate: HeightFieldGate
  ) {}

  /**
   * Разборка сценария. Граф разбирается до текстур: обратный порядок оставляет
   * окно, в котором материал ссылается на освобождённую текстуру, и отрисовка
   * в этом окне даёт предупреждения WebGL.
   *
   * Фон снимать отдельно не нужно: его рисует `SkyboxBackground`, обычный
   * потомок сцены, и ссылку на кубмапу освобождает обход графа в
   * `engine.dispose()`.
   *
   * Проверка утечек пропускается, пока в сессии ничего не построено: первая
   * разборка происходит в начале `run()`, и её снимок не содержит законных
   * долгоживущих ресурсов — как эталон он объявил бы утечкой всё подряд.
   */
  public teardown(): void {
    this.engine.dispose()
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()

    if (import.meta.env.DEV && this.everLoaded) {
      const leak = this.leakDetector.record()

      if (leak) {
        console.warn(
          `[LeakDetector] прирост с прошлой разборки: геометрий +${leak.geometries}, текстур +${leak.textures}`
        )
      }
    }
  }

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.teardown()

    this.resourceObserver.scenario = scenario
    await this.resourceObserver.loadPrimaryTextures()

    if (!this.resourceObserver.sceneBackground) {
      console.warn('[Application] Кубическая карта фона сценария не загружена, сцена останется без фона')
    } else {
      // Собственный проход вместо scene.background: только так расширение
      // хайлайтов применяется и к прямому фону (см. SkyboxBackground)
      this.scene.add(new SkyboxBackground(this.resourceObserver.sceneBackground))
    }

    this.everLoaded = true
    this.engine.start()

    // Синглтон гейта строится лениво контейнером — этот вызов и есть первая
    // подписка/пересчёт, запускающий загрузку карты ближайшего тела, не
    // дожидаясь первого ClosestChange от движения камеры.
    this.heightFieldGate.recompute()
  }

  public dispose(): void {
    this.teardown()
    this.resourceObserver.scenario = null
  }
}

export { Application }
