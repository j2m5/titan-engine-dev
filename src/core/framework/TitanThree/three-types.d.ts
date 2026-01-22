import 'three'
import { Model } from '@/core/framework/Memoquent/Model'

declare module 'three' {
  interface Object3D {
    model: Model | null
    update(delta?: number): void
  }

  interface Mesh {
    resetMaterial(): void
  }
}
