import { Object3D } from 'three'

interface IObject3DVisitor {
  visitRoot(object: Object3D): void
  visitNode(object: Object3D): void
  visitRootNode(object: Object3D): void
  visitComponent(object: Object3D): void
}

export type { IObject3DVisitor }
