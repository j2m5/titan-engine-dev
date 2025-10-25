import { Scene } from 'three'
import { ScenePostProcessor } from '@/core/graphic/postprocessing/ScenePostProcessor'
import { injectable } from 'inversify'
import { PostEffectPipeline } from '@/core/graphic/postprocessing/PostEffectPipeline'
import { PostEffectBuilder } from '@/core/graphic/postprocessing/PostEffectBuilder'
import { threeJS } from '@/core/graphic/ThreeJS'

export enum PostprocessingPresets {
  StarSystemDefault
}

export type PostprocessingPreset = keyof typeof PostprocessingPresets

@injectable()
class RenderManager {
  private presets: Map<PostprocessingPreset, ScenePostProcessor> = new Map<PostprocessingPreset, ScenePostProcessor>()
  private activePreset: PostprocessingPreset | null = null
  private activeScene: Scene | null = null

  public constructor() {
    this.registerRenderPipelines()
  }

  public register(preset: PostprocessingPreset, processor: ScenePostProcessor): RenderManager {
    this.presets.set(preset, processor)

    return this
  }

  public setActivePipeline(preset: PostprocessingPreset | null, scene: Scene | null): void {
    if (preset && scene && !this.presets.has(preset)) {
      console.error('Trying to activate unregistered pipeline')
      return
    }

    this.activePreset = preset
    this.activeScene = scene
  }

  public render(delta?: number): void {
    if (!this.activePreset || !this.activeScene) return

    const processor: ScenePostProcessor | undefined = this.presets.get(this.activePreset)

    processor?.render(delta)
  }

  private registerRenderPipelines(): void {
    const starSystemDefaultPipeline: PostEffectPipeline = new PostEffectPipeline(
      new PostEffectBuilder(threeJS.renderer)
    )

    this.register('StarSystemDefault', starSystemDefaultPipeline.collectForMainScene())
  }
}

export { RenderManager }
