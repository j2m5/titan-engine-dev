import { engineStore } from '@/ui/mobx/EngineStore'
import { Actor } from '@/core/models/Actor'
import { Object3D, Scene } from 'three'
import { RenderableFactory } from '@/core/new-renderables/RenderableFactory'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Object3DVisitor } from '@/core/services/visitors/Object3DVisitor'
import { ShouldRenderOrbitLine } from '@/core/new-renderables/types'

export function isAcceptable(object: unknown): object is Acceptable<IObject3DVisitor> {
  return (object as Acceptable<IObject3DVisitor>).accept !== undefined
}

export function hasOrbit(object: unknown): object is ShouldRenderOrbitLine {
  return (object as ShouldRenderOrbitLine).orbit !== undefined
}

class SceneManagerV2 {
  private testScene: Scene = new Scene()
  private buffer: Map<number, Object3D> = new Map()

  public make(): void {
    if (!engineStore.scenario) return

    const root = Actor.find(engineStore.scenario.rootId)

    if (!root) return

    const visitor = new Object3DVisitor(this.testScene)

    const rootObject3D = RenderableFactory.make(root)

    if (isAcceptable(rootObject3D)) rootObject3D.accept(visitor)

    root.children.eachRecursive((child: Actor): void => {
      const object3D = RenderableFactory.make(child)

      this.buffer.set(child.getAttribute('id'), object3D)

      if (child.parent) object3D.parent = this.buffer.get(child.parent.getAttribute('id')) || rootObject3D

      if (isAcceptable(object3D)) object3D.accept(visitor)

      if (hasOrbit(object3D)) object3D.orbit.accept(visitor)
    })

    this.buffer.clear()
  }
}

export { SceneManagerV2 }
