import { ICommand } from '@/core/commands/ICommand'
import { TransitionReceiver } from '@/core/commands/receivers/TransitionReceiver'
import { Application } from '@/Application'
import { Entity } from '@/core/framework/Entity'

class TransitionToStarSystemCommand implements ICommand {
  private receiver: TransitionReceiver
  private readonly context: Application
  private readonly starSystem: Entity

  public constructor(receiver: TransitionReceiver, context: Application, starSystem: Entity) {
    this.receiver = receiver
    this.context = context
    this.starSystem = starSystem
  }

  public execute(): void {
    this.receiver.transitionToStarSystem(this.context, this.starSystem)
  }
}

export { TransitionToStarSystemCommand }
