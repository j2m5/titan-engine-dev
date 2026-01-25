import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { LOD, Object3D, Scene } from 'three'

class Object3DVisitor implements IObject3DVisitor {
  private scene: Scene

  public constructor(scene: Scene) {
    this.scene = scene
  }

  public visitRoot(object: Object3D): void {
    this.scene.add(object)
  }

  public visitNode(object: Object3D): void {
    object.parent?.add(object)
  }

  public visitRootNode(object: Object3D): void {
    object.parent?.parent?.add(object)
  }

  public visitComponent(object: Object3D): void {
    const parent = object.parent

    if (parent) {
      if (parent.type === 'Group') {
        const lod = parent.getObjectByProperty('type', 'LOD') as LOD

        if (lod) {
          lod.children[0].add(object)
        }
      } else if (parent.type === 'Mesh') {
        parent.add(object)
      }
    }
  }
}

export { Object3DVisitor }
