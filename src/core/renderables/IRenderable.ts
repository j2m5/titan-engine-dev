import type { BufferGeometry, Material, Object3D } from 'three'

interface IRenderable<TGeometry = BufferGeometry, TMaterial = Material> {
  geometry?: TGeometry
  material?: TMaterial
  object3D: Object3D
  build(): Object3D
  update(delta?: number): void
}

export type { IRenderable }
