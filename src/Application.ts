import { inject, injectable } from 'inversify'
import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { SceneObserver } from '@/core/services/SceneObserver'
import { threeJS } from '@/core/graphic/ThreeJS'
import { resourceStorage } from '@/core/services/ResourceStorage'

@injectable()
class Application {
  public constructor(
    @inject('Engine') private engine: Engine,
    @inject('ResourceObserver') private resourceObserver: ResourceObserver,
    @inject('SceneObserver') private sceneObserver: SceneObserver
  ) {}

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.engine.dispose()

    this.resourceObserver.scenario = scenario
    await this.resourceObserver.loadPrimaryTextures()

    threeJS.scene.background = resourceStorage.getTexture('cubemaps-scene-main')!

    this.engine.start()

    this.sceneObserver.observable = threeJS.astroControls
    this.sceneObserver.scene = threeJS.scene
  }

  public dispose(): void {
    this.engine.dispose()
    this.resourceObserver.scenario = null
  }
}

export { Application }
