import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Scene } from 'three'
import type { LeakDetector } from '@/core/lifecycle/LeakDetector'

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
   * Фон сцены снимается до освобождения текстур по той же причине: кубическая
   * карта фона сценария живёт в `resourceStorage`, и если оставить ссылку на
   * месте, `scene.background` будет удерживать уже освобождённую текстуру и
   * её шесть изображений в куче.
   *
   * Проверка утечек пропускается, пока в этой сессии ещё ничего не было
   * построено: первая разборка сессии происходит в начале `run()`, до того как
   * что-либо создано, поэтому снимок в этот момент не содержит ни одного
   * законного пережившего разборку ресурса (шум диска, материал прицела,
   * заглушки `generateTexture`) и не годится в эталон — от него любая
   * следующая разборка выглядела бы утечкой навсегда.
   */
  public teardown(): void {
    this.engine.dispose()
    this.scene.background = null
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
    }

    this.scene.background = this.resourceObserver.sceneBackground

    this.everLoaded = true
    this.engine.start()
  }

  public dispose(): void {
    this.teardown()
    this.resourceObserver.scenario = null
  }
}

export { Application }
