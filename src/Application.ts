import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Scene } from 'three'
import type { LeakDetector } from '@/core/lifecycle/LeakDetector'
import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'

class Application {
  private everLoaded: boolean = false

  public constructor(
    private engine: Engine,
    private resourceObserver: ResourceObserver,
    private scene: Scene,
    private leakDetector: LeakDetector
  ) {}

  /**
   * Разборка сценария. Граф разбирается до текстур: обратный порядок оставляет
   * окно, в котором материал ссылается на освобождённую текстуру, и отрисовка
   * в этом окне даёт предупреждения WebGL.
   *
   * Отдельного снятия `scene.background` тут больше нет: фон рисует
   * собственный полноэкранный проход `SkyboxBackground` (обычный потомок
   * сцены), а `scene.background` в three больше не назначают вовсе — снимать
   * нечего. Ссылку на кубмапу фона снимает `engine.dispose()`: он обходит
   * `scene.children` через `disposeSceneTree` до освобождения текстур, и
   * `SkyboxBackground` вместе со своим юниформом `skybox` уходит из графа в
   * этом обходе.
   *
   * Проверка утечек пропускается, пока в этой сессии ещё ничего не было
   * построено: первая разборка сессии происходит в начале `run()`, до того как
   * что-либо создано, поэтому снимок в этот момент не содержит ни одного
   * законного пережившего разборку ресурса (шум диска, материал прицела,
   * заглушка `PlaceholderTexture`) и не годится в эталон — от него любая
   * следующая разборка выглядела бы утечкой навсегда.
   */
  public teardown(): void {
    this.engine.dispose()
    resourceStorage.deleteAllTextures()

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
  }

  public dispose(): void {
    this.teardown()
    this.resourceObserver.scenario = null
  }
}

export { Application }
