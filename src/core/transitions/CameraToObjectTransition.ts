import { Command } from '@/core/framework/commands/Command'
import { Actor } from '@/core/models/Actor'
import { Vector3 } from 'three'

interface CameraToObjectTransitionArgs {
  model: Actor
  from: Vector3
  to: Vector3
}

class CameraToObjectTransition extends Command<CameraToObjectTransitionArgs> {
  declare public model: Actor
  declare public from: Vector3
  declare public to: Vector3

  public handle(): Promise<void> | void {
    console.log(this.model)
    console.log(this.from)
    console.log(this.to)
    console.log('CameraToObjectTransition executed')
  }
}

export { CameraToObjectTransition }
