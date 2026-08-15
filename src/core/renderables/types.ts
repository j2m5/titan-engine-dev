import { OrbitLine } from '@/core/renderables/utils/OrbitLine'
import { BufferGeometry, Material, Object3D } from 'three'

export interface ShouldRenderOrbitLine {
  orbit: OrbitLine
}

export type RenderableObject3D<
  TGeometry extends BufferGeometry = BufferGeometry,
  TMaterial extends Material | Material[] = Material | Material[]
  // geometry опциональна: у группового renderable (TerrainSphere) геометрий
  // много; из потребителей контракта читается только material и quaternion
> = Object3D & { geometry?: TGeometry; material: TMaterial }
