import { PostEffectStep } from '@/core/graphic/postprocessing/PostEffectStep'
import { BloomEffectOptions, Effect, SelectiveBloomEffect } from 'postprocessing'
import { Camera, Object3D, Scene } from 'three'
import { getObjectsByUserDataProperty } from '@/core/helpers/finder'

class SelectiveBloomStep implements PostEffectStep {
  private readonly scene: Scene
  private readonly camera: Camera
  private readonly config: BloomEffectOptions

  public constructor(scene: Scene, camera: Camera, config: BloomEffectOptions) {
    this.scene = scene
    this.camera = camera
    this.config = config
  }

  public apply(): Effect {
    const effect: SelectiveBloomEffect = new SelectiveBloomEffect(this.scene, this.camera, this.config)

    const objectsToBloom: Object3D[] = getObjectsByUserDataProperty(this.scene, 'hasBloom', true)

    effect.selection.set(objectsToBloom)

    return effect
  }
}

export { SelectiveBloomStep }
