import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Group, LOD, Object3D, Scene } from 'three'

function hasEquatorialFrame(object: Object3D): object is Object3D & { equatorialFrame: Group } {
  return (object as { equatorialFrame?: Group }).equatorialFrame !== undefined
}

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
      if (hasEquatorialFrame(parent)) {
        // Кольца и атмосферы живут в экваториальной рамке тела:
        // наклонены по полюсу, но не вращаются вместе с мешем
        parent.equatorialFrame.add(object)
      } else if (parent.type === 'Group') {
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
