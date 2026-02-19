import {
  IActor,
  IOrbit,
  IRenderingObject,
  IRotationObject,
  IPhysicalObject,
  IPlacement,
  IResource
} from '@/core/models/types'
import { StarSystems } from './StarSystems'
import { Barycenters } from './Barycenters'
import { CelestialObjects } from './CelestialObjects'
import { Atmospheres } from '@storage/database/actors/MilkyWay/Atmospheres'
import { Rings } from '@storage/database/actors/MilkyWay/Rings'
import { PhysicalObjects } from './PhysicalObjects'
import { RenderingObjects } from './RenderingObjects'
import { Orbits } from './Orbits'
import { RotationObjects } from '@storage/database/actors/MilkyWay/RotationObjects'
import { Placements } from '@storage/database/actors/MilkyWay/Placements'
import { Resources } from './Resources'

const Root: IActor = {
  id: 19,
  categoryId: 2,
  parentId: null,
  name: 'Milky Way',
  description: '',
  color: '#ffffff'
}

export const MilkyWayActors: IActor[] = [
  Root,
  ...StarSystems,
  ...Barycenters,
  ...CelestialObjects,
  ...Atmospheres,
  ...Rings
]
export const MilkyWayPhysicalObjects: IPhysicalObject[] = PhysicalObjects
export const MilkyWayRenderingObjects: IRenderingObject[] = RenderingObjects
export const MilkyWayOrbits: IOrbit[] = Orbits
export const MilkyWayRotationObjects: IRotationObject[] = RotationObjects
export const MilkyWayPlacements: IPlacement[] = Placements
export const MilkyWayResources: IResource[] = Resources
