import { inject, injectable } from 'inversify'
import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { threeJS } from '@/core/graphic/ThreeJS'

@injectable()
class Application {
  public constructor(
    @inject('Engine') private engine: Engine,
    @inject('ResourceObserver') private resourceObserver: ResourceObserver
  ) {}

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.engine.dispose()

    this.resourceObserver.scenario = scenario
    await this.resourceObserver.loadPrimaryTextures()

    if (!this.resourceObserver.sceneBackground) {
      console.warn('[Application] Кубическая карта фона сценария не загружена, сцена останется без фона')
    }

    threeJS.scene.background = this.resourceObserver.sceneBackground

    this.engine.start()
  }

  public dispose(): void {
    this.engine.dispose()
    this.resourceObserver.scenario = null
  }
}

export { Application }
