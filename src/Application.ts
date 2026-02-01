import { inject, injectable } from 'inversify'
import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { threeJS } from '@/core/graphic/ThreeJS'
import { resourceStorage } from '@/core/services/ResourceStorage'

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

    threeJS.scene.background = resourceStorage.getTexture('cubemaps-scene-main')!
    console.log(threeJS.scene)

    this.engine.start()
  }

  public dispose(): void {
    this.engine.dispose()
    this.resourceObserver.scenario = null
  }
}

export { Application }
