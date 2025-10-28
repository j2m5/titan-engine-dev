import { inject, injectable } from 'inversify'
import { Engine } from '@/core/Engine'
import { ScenarioLoader } from '@/core/services/ScenarioLoader'
import { SceneManager } from '@/core/services/SceneManager'
import { RenderSystem } from '@/core/systems/RenderSystem'
import { EntitySystem } from '@/core/systems/EntitySystem'
import { ScenarioConfig } from '@/config/scenarios'
import { SceneObserver } from '@/core/services/SceneObserver'
import { threeJS } from '@/core/graphic/ThreeJS'

@injectable()
class Application {
  public constructor(
    @inject('Engine') private engine: Engine,
    @inject('ScenarioLoader') private scenarioLoader: ScenarioLoader,
    @inject('SceneManager') private sceneManager: SceneManager,
    @inject('RenderSystem') private renderSystem: RenderSystem,
    @inject('EntitySystem') private entitySystem: EntitySystem,
    @inject('SceneObserver') private sceneObserver: SceneObserver
  ) {}

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.engine.dispose()

    this.scenarioLoader.scenario = scenario
    await this.scenarioLoader.load()

    this.engine.addSystem(this.renderSystem)
    this.engine.addSystem(this.entitySystem)

    this.sceneManager.build()

    this.sceneObserver.observable = threeJS.astroControls
    this.sceneObserver.scene = threeJS.scene

    this.engine.start()
  }

  public dispose(): void {
    this.engine.dispose()
    this.scenarioLoader.scenario = null
  }
}

export { Application }
