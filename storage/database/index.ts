import {
  ICategory,
  IActor,
  IOrbit,
  IRotationObject,
  IPhysicalObject,
  IResource,
  IRenderingObject,
  IPlacement
} from '@/core/models/types'
import { __Categories } from './categories'
import {
  __Actors,
  __Orbits,
  __RotationObjects,
  __PhysicalObjects,
  __Placements,
  __RenderingObjects,
  __Resources
} from './actors'

const CommonResources: IResource[] = [
  {
    id: 90,
    actorId: null,
    resourceType: 'diffuse',
    path: 'sun_glow.png',
    lifetime: 0,
    colorSpace: 'srgb'
  },
  {
    id: 91,
    actorId: null,
    resourceType: 'diffuse',
    path: 'star.png',
    lifetime: 0,
    colorSpace: 'srgb-linear'
  },
  {
    id: 92,
    actorId: null,
    resourceType: 'diffuse',
    path: 'asteroid.jpg',
    lifetime: 0,
    colorSpace: 'srgb-linear'
  },
  {
    id: 93,
    actorId: null,
    resourceType: 'diffuse',
    path: 'night.jpg',
    lifetime: 0
  },
  {
    id: 100,
    actorId: null,
    resourceType: 'diffuse',
    path: 'galaxy.png',
    lifetime: 0
  },
  {
    id: 101,
    actorId: null,
    resourceType: 'diffuse',
    path: 'default.png',
    lifetime: 0,
    colorSpace: 'srgb-linear'
  },
  {
    id: 102,
    actorId: null,
    resourceType: 'diffuse',
    path: 'sun.png',
    lifetime: 0,
    colorSpace: 'srgb'
  },
  {
    id: 103,
    actorId: null,
    resourceType: 'diffuse',
    path: 'round.png',
    lifetime: 0,
    colorSpace: 'srgb'
  },
  {
    id: 104,
    actorId: null,
    resourceType: 'diffuse',
    path: 'asteroid_bump.jpg',
    lifetime: 0,
    colorSpace: 'srgb'
  }
]

const CommonCubemapResources: IResource[] = [
  {
    id: 94,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/px.jpg',
    lifetime: 0
  },
  {
    id: 95,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/nx.jpg',
    lifetime: 0
  },
  {
    id: 96,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/py.jpg',
    lifetime: 0
  },
  {
    id: 97,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/ny.jpg',
    lifetime: 0
  },
  {
    id: 98,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/pz.jpg',
    lifetime: 0
  },
  {
    id: 99,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/nz.jpg',
    lifetime: 0
  },
  {
    id: 107,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/px.png',
    lifetime: 0
  },
  {
    id: 108,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/nx.png',
    lifetime: 0
  },
  {
    id: 109,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/py.png',
    lifetime: 0
  },
  {
    id: 110,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/ny.png',
    lifetime: 0
  },
  {
    id: 111,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/pz.png',
    lifetime: 0
  },
  {
    id: 112,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/nz.png',
    lifetime: 0
  }
]

export const Categories: ICategory[] = __Categories
export const Actors: IActor[] = __Actors
export const PhysicalObjects: IPhysicalObject[] = __PhysicalObjects
export const RenderingObjects: IRenderingObject[] = __RenderingObjects
export const Orbits: IOrbit[] = __Orbits
export const RotationObjects: IRotationObject[] = __RotationObjects
export const Placements: IPlacement[] = __Placements
export const Resources: IResource[] = [...__Resources, ...CommonResources, ...CommonCubemapResources]
