import { Object3D, Scene } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { MarkerManager } from '@/core/services/MarkerManager'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Object3DVisitor } from '@/core/services/visitors/Object3DVisitor'
import { Actor } from '@/core/models/Actor'
import { Crosshair } from '@/core/renderables/utils/Crosshair'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { OrbitLine } from '@/core/renderables/utils/OrbitLine'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { RenderableObject3D, ShouldRenderOrbitLine } from '@/core/renderables/types'
import { scenarioContext } from '@/core/scenario/ScenarioContext'
import { threeJS } from '@/core/graphic/ThreeJS'
import { Settings } from '@/core/ports/Settings'
import { UpdateContext } from '@/core/UpdateContext'

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
  private orbitLines: OrbitLine[] = []

  public constructor(
    private markerManager: MarkerManager,
    private settings: Settings
  ) {}

  public initialize(): void {
    this.orbitLines = []
    if (!scenarioContext.current) return

    const root = Actor.find(scenarioContext.rootId!)

    if (!root) return

    const visitor = new Object3DVisitor(this.scene)

    const rootObject3D = RenderableFactory.make(root)

    if (isAcceptable(rootObject3D)) rootObject3D.accept(visitor)

    root.children.eachRecursive((child: Actor, depth: number): void => {
      const object3D = RenderableFactory.make(child)

      this.buffer.set(child.getAttribute('id'), object3D)

      if (child.parent) object3D.parent = this.buffer.get(child.parent.getAttribute('id')) || rootObject3D

      if (isAcceptable(object3D)) object3D.accept(visitor)

      if (hasOrbit(object3D)) {
        object3D.orbit.accept(visitor)
        this.orbitLines.push(object3D.orbit)
      }

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

  public update(ctx: UpdateContext): void {
    for (const line of this.orbitLines) {
      line.visible = this.settings.showOrbitLines
    }

    this.scene.traverse((object: Object3D): void => object.updateObject(ctx))
    this.markerManager.update()
  }
}

export { SceneManager }
