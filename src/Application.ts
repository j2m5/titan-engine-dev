import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Scene } from 'three'

class Application {
  public constructor(
    private engine: Engine,
    private resourceObserver: ResourceObserver,
    private scene: Scene
  ) {}

  /**
   * Разборка сценария. Граф разбирается до текстур: обратный порядок оставляет
   * окно, в котором материал ссылается на освобождённую текстуру, и отрисовка
   * в этом окне даёт предупреждения WebGL.
   */
  public teardown(): void {
    this.engine.dispose()
    resourceStorage.deleteAllTextures()
  }

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.teardown()

    this.resourceObserver.scenario = scenario
    await this.resourceObserver.loadPrimaryTextures()

    if (!this.resourceObserver.sceneBackground) {
      console.warn('[Application] Кубическая карта фона сценария не загружена, сцена останется без фона')
    }

    this.scene.background = this.resourceObserver.sceneBackground

    this.engine.start()
  }

  public dispose(): void {
    this.teardown()
    this.resourceObserver.scenario = null
  }
}

export { Application }
