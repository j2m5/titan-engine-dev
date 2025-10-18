import { AppState } from '@/core/services/states/AppState'
import { Scene } from 'three'
import { threeJS } from '@/core/graphic/ThreeJS'
import { Actor } from '@/core/models/Actor'
import { AppStates, IActor, IResource } from '@/core/models/types'
import { ScenarioConfig } from '@/config/scenarios'
import { engineStore } from '@/ui/mobX/EngineStore'
import { getTextureByKey, TextureConfig } from '@/config/textures'
import { Resource } from '@/core/models/Resource'
import { Collection } from '@/core/framework/Memoquent/Collection'

class StarSystemAppState extends AppState {
  public readonly uuid: AppStates = 'starSystem'
  public readonly scene: Scene
  public readonly map: Map<number, Actor>

  public constructor() {
    super()
    this.scene = threeJS.scene
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

      const starSystem: Actor | undefined = children.find(this.entityId!)

      this.map.set(root.getAttribute('id'), root)

      if (starSystem) {
        this.map.set(starSystem.getAttribute('id'), starSystem)

        starSystem.children.eachRecursive((actor: Actor): void => {
          this.map.set(actor.getAttribute('id'), actor)
        })
      }

      console.log('star-system', this.map)
    }
  }

  public async load(): Promise<void> {
    this.build()

    for (const actor of this.map.values()) {
      TextureConfig.BitmapsToLoad.push(...actor.resources.map((resource: Resource) => resource.attributes as IResource))
    }

    await this.context.imageBitmapManager.loadAll(TextureConfig.BitmapsToLoad)

    this.scene.background = getTextureByKey('cubemaps-scene-colored')!

    this.context.renderManager.setActivePipeline('StarSystemDefault', this.scene)
    console.log('scene', this.scene)
  }

  public override clear(): void {
    super.clear()
    this.context.imageBitmapManager.removeAll()
  }
}

export { StarSystemAppState }
