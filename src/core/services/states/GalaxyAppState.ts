import { AppState } from '@/core/services/states/AppState'
import { Scene, Vector3 } from 'three'
import { threeJS } from '@/core/graphic/ThreeJS'
import { getTextureByKey, TextureConfig } from '@/config/textures'
import { ScenarioConfig } from '@/config/scenarios'
import { engineStore } from '@/ui/mobX/EngineStore'
import { AppStates, IActor } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { Collection } from '@/core/framework/Memoquent/Collection.ts'

class GalaxyAppState extends AppState {
  public readonly uuid: AppStates = 'galaxy'
  public readonly scene: Scene
  public readonly map: Map<number, Actor>

  public constructor() {
    super()
    this.scene = threeJS.galaxyScene
    this.map = new Map<number, Actor>()
  }

  protected build(): void {
    const scenario: ScenarioConfig | null = engineStore.scenario

    if (!scenario) return

    const data: Partial<IActor> | undefined = Actor.find(scenario.actorId)?.attributes

    if (data && data.id) {
      const root: Actor | undefined = Actor.find(data.id)?.with('children')

      if (!root) return

      const children: Collection<Actor> = root.children

      this.map.set(root.getAttribute('id'), root)

      children.each((child: Actor): void => {
        this.map.set(child.getAttribute('id'), child)
      })

      console.log(this.map)
    }
  }

  public async load(): Promise<void> {
    this.build()

    await this.context.cubeMapTextureManager.loadAll(TextureConfig.CubeFilesToLoad)

    this.scene.background = getTextureByKey('cubemaps-scene-colored')!

    this.context.renderManager.setActivePipeline('GalaxyDefault', this.scene)

    threeJS.camera.position.set(500, 0, 500)
    threeJS.camera.lookAt(new Vector3())
    console.log(this.scene)
  }
}

export { GalaxyAppState }
