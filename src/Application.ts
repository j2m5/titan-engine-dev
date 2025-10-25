import { inject, injectable } from 'inversify'
import DIServices from '@/core/framework/DI/DIServices'
import { Engine } from '@/core/Engine'
import { ScenarioLoader } from '@/core/services/ScenarioLoader'
import { SceneManager } from '@/core/services/SceneManager'
import { RenderSystem } from '@/core/systems/RenderSystem'
import { EntitySystem } from '@/core/systems/EntitySystem'
import { ScenarioConfig } from '@/config/scenarios'
import { CameraObserver } from '@/core/services/CameraObserver'
import { threeJS } from '@/core/graphic/ThreeJS'

@injectable()
class Application {
  public constructor(
    @inject(DIServices.Engine) private engine: Engine,
    @inject(DIServices.ScenarioLoader) private scenarioLoader: ScenarioLoader,
    @inject(DIServices.SceneManager) private sceneManager: SceneManager,
    @inject(DIServices.RenderSystem) private renderSystem: RenderSystem,
    @inject(DIServices.EntitySystem) private entitySystem: EntitySystem,
    @inject(DIServices.CameraObserver) private cameraObserver: CameraObserver
  ) {}

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.engine.dispose()

    this.scenarioLoader.scenario = scenario
    await this.scenarioLoader.load()

    this.engine.addSystem(this.renderSystem)
    this.engine.addSystem(this.entitySystem)

    this.sceneManager.build()

    this.cameraObserver.observable = threeJS.astroControls
    this.cameraObserver.scene = threeJS.scene

    this.engine.start()
  }

  public dispose(): void {
    this.engine.dispose()
    this.scenarioLoader.scenario = null
  }
}

export { Application }
