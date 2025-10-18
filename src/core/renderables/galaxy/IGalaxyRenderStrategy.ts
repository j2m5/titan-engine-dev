import { Object3D } from 'three'

interface IGalaxyRenderStrategy {
  build(): Object3D
  update(delta?: number): void
}

export type { IGalaxyRenderStrategy }
