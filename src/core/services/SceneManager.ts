import { inject, injectable } from 'inversify'
import { Object3D, Scene } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { MarkerManager } from '@/core/services/MarkerManager'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Object3DVisitor } from '@/core/services/visitors/Object3DVisitor'
import { Actor } from '@/core/models/Actor'
import { Crosshair } from '@/core/renderables/utils/Crosshair'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { RenderableObject3D, ShouldRenderOrbitLine } from '@/core/renderables/types'
import { threeJS } from '@/core/graphic/ThreeJS'
import { engineStore } from '@/ui/mobx/EngineStore'

export function isAcceptable(object: unknown): object is Acceptable<IObject3DVisitor> {
  return (object as Acceptable<IObject3DVisitor>).accept !== undefined
}

export function hasRenderable(object: unknown): object is { renderable: RenderableObject3D | null } {
  return (object as { renderable: RenderableObject3D | null }).renderable !== undefined
}

export function hasOrbit(object: unknown): object is ShouldRenderOrbitLine {
  return (object as ShouldRenderOrbitLine).orbit !== undefined
}

@injectable()
class SceneManager {
  public crosshair: CSS2DObject = new Crosshair()
  private scene: Scene = threeJS.scene
  private buffer: Map<number, Object3D> = new Map()

  public constructor(@inject('MarkerManager') private markerManager: MarkerManager) {}

  public initialize(): void {
    if (!engineStore.scenario) return

    const root = Actor.find(engineStore.scenario.rootId)

    if (!root) return

    const visitor = new Object3DVisitor(this.scene)

    const rootObject3D = RenderableFactory.make(root)

    if (isAcceptable(rootObject3D)) rootObject3D.accept(visitor)

    root.children.eachRecursive((child: Actor, depth: number): void => {
      const object3D = RenderableFactory.make(child)

      this.buffer.set(child.getAttribute('id'), object3D)

      if (child.parent) object3D.parent = this.buffer.get(child.parent.getAttribute('id')) || rootObject3D

      if (isAcceptable(object3D)) object3D.accept(visitor)

      if (hasOrbit(object3D)) object3D.orbit.accept(visitor)

      if (object3D instanceof DynamicNode && hasRenderable(object3D) && object3D.renderable !== null) {
        this.markerManager.add({
          model: child,
          object: object3D,
          shape: 'hex',
          depth,
          onClick: (): void => {
            object3D.renderable?.parent?.add(this.crosshair)
          }
        })
      }
    })

    this.buffer.clear()
  }

  public update(delta?: number): void {
    this.scene.traverse((object: Object3D): void => object.updateObject(delta))
    this.markerManager.update()
  }
}

export { SceneManager }
