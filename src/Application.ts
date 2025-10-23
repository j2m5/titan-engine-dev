import { Engine } from '@/core/Engine'
import { RenderSystem } from '@/core/systems/RenderSystem'
import { EntitySystem } from '@/core/systems/EntitySystem'
import { SceneManager } from '@/core/services/SceneManager'
import { inject, injectable } from 'inversify'
import DIServices from '@/core/framework/DI/DIServices'
import { ScenarioConfig } from '@/config/scenarios'
import { ScenarioLoader } from '@/core/services/ScenarioLoader'

@injectable()
class Application {
  public constructor(
    @inject(DIServices.Engine) public engine: Engine,
    @inject(DIServices.ScenarioLoader) private scenarioLoader: ScenarioLoader,
    @inject(DIServices.SceneManager) private sceneManager: SceneManager,
    @inject(DIServices.RenderSystem) private renderSystem: RenderSystem,
    @inject(DIServices.EntitySystem) private entitySystem: EntitySystem
  ) {}

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.engine.dispose()

    this.scenarioLoader.scenario = scenario
    await this.scenarioLoader.load()

    this.engine.addSystem(this.renderSystem)
    this.engine.addSystem(this.entitySystem)

    this.sceneManager.build()

    this.engine.start()
  }

  public dispose(): void {
    this.engine.dispose()
    this.scenarioLoader.scenario = null
  }
}

export { Application }
