import {
  IActor,
  IOrbit,
  IRenderingObject,
  IRotationObject,
  IPhysicalObject,
  IPlacement,
  IResource
} from '@/core/models/types'
import {
  StarWarsActors,
  StarWarsOrbits,
  StarWarsRotationObjects,
  StarWarsPhysicalObjects,
  StarWarsPlacements,
  StarWarsRenderingObjects,
  StarWarsResources
} from './StarWars'
import {
  MilkyWayActors,
  MilkyWayOrbits,
  MilkyWayRotationObjects,
  MilkyWayPhysicalObjects,
  MilkyWayPlacements,
  MilkyWayRenderingObjects,
  MilkyWayResources
} from './MilkyWay'

export const __Actors: IActor[] = [...StarWarsActors, ...MilkyWayActors]
export const __PhysicalObjects: IPhysicalObject[] = [...StarWarsPhysicalObjects, ...MilkyWayPhysicalObjects]
export const __RenderingObjects: IRenderingObject[] = [...StarWarsRenderingObjects, ...MilkyWayRenderingObjects]
export const __Orbits: IOrbit[] = [...StarWarsOrbits, ...MilkyWayOrbits]
export const __RotationObjects: IRotationObject[] = [...StarWarsRotationObjects, ...MilkyWayRotationObjects]
export const __Placements: IPlacement[] = [...StarWarsPlacements, ...MilkyWayPlacements]
export const __Resources: IResource[] = [...StarWarsResources, ...MilkyWayResources]
