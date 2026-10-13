import 'three'
import { Actor } from '@/core/models/Actor'

declare module 'three' {
  interface Object3D {
    model: Actor | null
    getObjectsByUserDataProperty(key: string, value: unknown, result: Object3D[] = []): Object3D[]
    __setup(): void
    updateObject(ctx: import('@/core/UpdateContext').UpdateContext): void
    /** Параметры вида после follow/коллизий, до обновления матриц и отсечения рендерером. */
    updateView?(camera: import('three').PerspectiveCamera): void
  }

  interface Mesh extends Object3D {
    resetMaterial(): void
  }
}
