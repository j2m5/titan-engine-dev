import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { threeJS } from '@/core/graphic/ThreeJS'

class Application {
  public constructor(
    private engine: Engine,
    private resourceObserver: ResourceObserver
  ) {}

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.engine.dispose()

    this.resourceObserver.scenario = scenario
    await this.resourceObserver.loadPrimaryTextures()

    if (!this.resourceObserver.sceneBackground) {
      console.warn('[Application] Кубическая карта фона сценария не загружена, сцена останется без фона')
    }

    threeJS.scene.background = this.resourceObserver.sceneBackground
    console.log(threeJS.scene)

    this.engine.start()
  }

  public dispose(): void {
    this.engine.dispose()
    this.resourceObserver.scenario = null
  }
}

export { Application }
