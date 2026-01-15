import { inject, injectable } from 'inversify'
import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { SceneManager } from '@/core/services/SceneManager'
import { RenderSystem } from '@/core/systems/RenderSystem'
import { EntitySystem } from '@/core/systems/EntitySystem'
import { ScenarioConfig } from '@/config/scenarios'
import { SceneObserver } from '@/core/services/SceneObserver'
import { threeJS } from '@/core/graphic/ThreeJS'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Resource } from '@/core/models/Resource'
import { Actor } from '@/core/models/Actor'

@injectable()
class Application {
  public constructor(
    @inject('Engine') private engine: Engine,
    @inject('ResourceObserver') private resourceObserver: ResourceObserver,
    @inject('SceneManager') private sceneManager: SceneManager,
    @inject('RenderSystem') private renderSystem: RenderSystem,
    @inject('EntitySystem') private entitySystem: EntitySystem,
    @inject('SceneObserver') private sceneObserver: SceneObserver
  ) {}

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.engine.dispose()

    this.resourceObserver.scenario = scenario
    await this.resourceObserver.loadPrimaryTextures()

    threeJS.scene.background = resourceStorage.getTexture('cubemaps-scene-main')!

    this.engine.addSystem(this.renderSystem)
    this.engine.addSystem(this.entitySystem)

    this.sceneManager.build()

    this.sceneObserver.observable = threeJS.astroControls
    this.sceneObserver.scene = threeJS.scene

    this.engine.start()
    console.log(threeJS.renderer.info)
    console.log(Resource.all())
    console.log(Resource.query().get())
    console.log('all', Actor.all())
    console.log('withGlobalScopes', Actor.query().get())
    console.log('withoutGlobalScopes', Actor.query().withoutGlobalScopes().get())
    console.log('withoutGlobalScope', Actor.query().withoutGlobalScope('scenario').get())
  }

  public dispose(): void {
    this.engine.dispose()
    this.resourceObserver.scenario = null
  }
}

export { Application }
