import { Object3D, Scene, Vector3 } from 'three'
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
import { scenarioContext } from '@/core/scenario/ScenarioContext'
import { threeJS } from '@/core/graphic/ThreeJS'
import { Nebula } from '@/core/renderables/Nebula/Nebula'

export function isAcceptable(object: unknown): object is Acceptable<IObject3DVisitor> {
  return (object as Acceptable<IObject3DVisitor>).accept !== undefined
}

export function hasRenderable(object: unknown): object is { renderable: RenderableObject3D | null } {
  return (object as { renderable: RenderableObject3D | null }).renderable !== undefined
}

export function hasOrbit(object: unknown): object is ShouldRenderOrbitLine {
  return (object as ShouldRenderOrbitLine).orbit !== undefined
}

class SceneManager {
  public crosshair: CSS2DObject = new Crosshair()
  private scene: Scene = threeJS.scene
  private buffer: Map<number, Object3D> = new Map()

  public constructor(private markerManager: MarkerManager) {}

  public initialize(): void {
    if (!scenarioContext.current) return

    const root = Actor.find(scenarioContext.rootId!)

    if (!root) return

    // todo test
    const n = new Nebula({
      center: new Vector3(160086.55871384568, 4303.140598442052, 11972.090991472533),
      radius: 10000,
      warpStrength: 0.7,
      anisotropy: new Vector3(1, 0.4, 1),
      edgeHardness: 0.3
    })

    this.scene.add(n)

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
