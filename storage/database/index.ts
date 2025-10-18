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
    colorSpace: 'srgb-linear'
  },
  {
    id: 91,
    actorId: null,
    resourceType: 'diffuse',
    path: 'star.png',
    colorSpace: 'srgb-linear'
  },
  {
    id: 92,
    actorId: null,
    resourceType: 'diffuse',
    path: 'asteroid.jpg',
    colorSpace: 'srgb-linear'
  },
  {
    id: 93,
    actorId: null,
    resourceType: 'diffuse',
    path: 'night.jpg'
  },
  {
    id: 100,
    actorId: null,
    resourceType: 'diffuse',
    path: 'galaxy.png'
  },
  {
    id: 101,
    actorId: null,
    resourceType: 'diffuse',
    path: 'lensflare1.png',
    colorSpace: 'srgb'
  },
  {
    id: 102,
    actorId: null,
    resourceType: 'diffuse',
    path: 'lensflare2.png',
    colorSpace: 'srgb'
  },
  {
    id: 103,
    actorId: null,
    resourceType: 'diffuse',
    path: 'lensflare3.png',
    colorSpace: 'srgb'
  },
  {
    id: 104,
    actorId: null,
    resourceType: 'diffuse',
    path: 'accretion_disk.png',
    colorSpace: 'srgb'
  },
  {
    id: 105,
    actorId: null,
    resourceType: 'diffuse',
    path: 'star_noise.png',
    colorSpace: 'srgb-linear'
  },
  {
    id: 106,
    actorId: null,
    resourceType: 'diffuse',
    path: 'test-bg.jpg',
    colorSpace: 'srgb-linear'
  }
]

const CommonCubemapResources: IResource[] = [
  /*{
    id: 94,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/px.jpg'
  },
  {
    id: 95,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/nx.jpg'
  },
  {
    id: 96,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/py.jpg'
  },
  {
    id: 97,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/ny.jpg'
  },
  {
    id: 98,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/pz.jpg'
  },
  {
    id: 99,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/main/nz.jpg'
  },*/
  {
    id: 107,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/px.png'
  },
  {
    id: 108,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/nx.png'
  },
  {
    id: 109,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/py.png'
  },
  {
    id: 110,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/ny.png'
  },
  {
    id: 111,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/pz.png'
  },
  {
    id: 112,
    actorId: null,
    resourceType: 'cube',
    path: 'cubemaps/scene/colored/nz.png'
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
