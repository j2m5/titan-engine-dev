import { OrbitLine } from '@/core/new-renderables/utils/OrbitLine'
import { BufferGeometry, Material, Object3D } from 'three'

export interface ShouldRenderOrbitLine {
  orbit: OrbitLine
}

export type RenderableObject3D<
  TGeometry extends BufferGeometry = BufferGeometry,
  TMaterial extends Material | Material[] = Material | Material[]
> = Object3D & { geometry: TGeometry; material: TMaterial }
