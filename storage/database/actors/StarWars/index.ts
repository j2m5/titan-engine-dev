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
import { Atmospheres } from '@storage/database/actors/StarWars/Atmospheres'
import { Rings } from '@storage/database/actors/StarWars/Rings'
import { PhysicalObjects } from './PhysicalObjects'
import { RenderingObjects } from './RenderingObjects'
import { Orbits } from './Orbits'
import { RotationObjects } from '@storage/database/actors/StarWars/RotationObjects'
import { Placements } from '@storage/database/actors/StarWars/Placements'
import { Resources } from './Resources'

const Root: IActor = {
  id: 1,
  categoryId: 2,
  parentId: null,
  name: 'Star Wars Galaxy',
  description: '',
  color: '#ffffff'
}

export const StarWarsActors: IActor[] = [
  Root,
  ...StarSystems,
  ...Barycenters,
  ...CelestialObjects,
  ...Atmospheres,
  ...Rings
]
export const StarWarsPhysicalObjects: IPhysicalObject[] = PhysicalObjects
export const StarWarsRenderingObjects: IRenderingObject[] = RenderingObjects
export const StarWarsOrbits: IOrbit[] = Orbits
export const StarWarsRotationObjects: IRotationObject[] = RotationObjects
export const StarWarsPlacements: IPlacement[] = Placements
export const StarWarsResources: IResource[] = Resources
