import { EffectComposer } from 'postprocessing'

class ScenePostProcessor {
  public readonly composer: EffectComposer

  public constructor(composer: EffectComposer) {
    this.composer = composer
  }

  public render(delta?: number): void {
    this.composer.render(delta)
  }

  public dispose(): void {
    this.composer.dispose()
  }
}

export { ScenePostProcessor }
