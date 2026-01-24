import 'three'
import { Model } from '@/core/framework/Memoquent/Model'

declare module 'three' {
  interface Object3D {
    model: Model | null
    getObjectsByUserDataProperty(object: Object3D, key: string, value: any, result: Object3D[] = []): Object3D[]
    __setup(): void
    updateObject(delta?: number): void
  }

  interface Group extends Object3D {}

  interface Mesh extends Object3D {
    resetMaterial(): void
  }

  interface Line extends Object3D {}

  interface Sprite extends Object3D {}

  interface CSS2DObject extends Object3D {}

  interface InstancedMesh extends Object3D {}
}
