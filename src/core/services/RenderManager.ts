import { injectable } from 'inversify'
import { postprocessing } from '@/core/graphic/Postprocessing'

@injectable()
class RenderManager {
  public initialize(): void {
    postprocessing.init()
  }

  public render(delta?: number): void {
    postprocessing.render(delta)
  }
}

export { RenderManager }
