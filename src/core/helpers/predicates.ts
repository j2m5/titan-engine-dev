import { Line, Mesh, Points, Sprite } from 'three'
import { IRenderable } from '@/core/renderables/IRenderable'

type HavingMaterial = Mesh | Sprite | Line | Points

export function isHavingMaterial(object: unknown): object is HavingMaterial {
  return object instanceof Mesh || object instanceof Sprite || object instanceof Line || object instanceof Points
}

export function isRenderable(object: unknown): object is IRenderable {
  return (object as IRenderable).object3D !== undefined
}
