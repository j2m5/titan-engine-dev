import { IResource } from '@/core/models/types'
import { SolarSystemResources } from './SolarSystem/Resources.ts'

const TOI519Resources: IResource[] = [
  {
    id: 16,
    actorId: 22,
    resourceType: 'diffuse',
    path: 'planets/exoplanets/toi_519b/toi_519b.jpg',
    colorSpace: 'srgb'
  },
  {
    id: 17,
    actorId: 22,
    resourceType: 'night',
    path: 'planets/exoplanets/toi_519b/toi_519b_night.png',
    colorSpace: 'srgb'
  }
]

export const SolarResources: IResource[] = [...SolarSystemResources]

export const Resources: IResource[] = [...TOI519Resources, ...SolarResources]
