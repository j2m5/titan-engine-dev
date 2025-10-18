import { ICommand } from '@/core/commands/ICommand.ts'
import { TransitionReceiver } from '@/core/commands/receivers/TransitionReceiver.ts'
import { Application } from '@/Application.ts'
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
