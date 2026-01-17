import { IResource } from '@/core/models/types'

const TatooResources: IResource[] = [
  {
    id: 1,
    actorId: 6,
    resourceType: 'diffuse',
    path: 'planets/StarWars/tatooine/tatooine.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 2,
    actorId: 7,
    resourceType: 'diffuse',
    path: 'planets/StarWars/ohann/ohann.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 3,
    actorId: 8,
    resourceType: 'diffuse',
    path: 'planets/StarWars/adriana/adriana.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 4,
    actorId: 9,
    resourceType: 'diffuse',
    path: 'planets/StarWars/ghomrassen/ghomrassen.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 5,
    actorId: 10,
    resourceType: 'diffuse',
    path: 'planets/StarWars/guermessa/guermessa.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 6,
    actorId: 11,
    resourceType: 'diffuse',
    path: 'planets/StarWars/chenini/chenini.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 7,
    actorId: 12,
    resourceType: 'diffuse',
    path: 'planets/unnamed/unnamed_planet_5.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 8,
    actorId: 13,
    resourceType: 'diffuse',
    path: 'planets/unnamed/unnamed_planet_6.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 9,
    actorId: 14,
    resourceType: 'diffuse',
    path: 'planets/unnamed/unnamed_planet_7.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 10,
    actorId: 15,
    resourceType: 'diffuse',
    path: 'planets/unnamed/unnamed_planet_1.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 11,
    actorId: 16,
    resourceType: 'diffuse',
    path: 'planets/unnamed/unnamed_planet_3.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 12,
    actorId: 17,
    resourceType: 'diffuse',
    path: 'planets/StarWars/adriana3/adriana3.jpg',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 13,
    actorId: 17,
    resourceType: 'bump',
    path: 'planets/StarWars/adriana3/adriana3_bump.jpg',
    lifetime: 60000
  },
  {
    id: 14,
    actorId: 18,
    resourceType: 'diffuse',
    path: 'planets/unnamed/unnamed_planet_5.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 15,
    actorId: 70,
    resourceType: 'diffuse',
    path: 'planets/StarWars/adriana/adriana_rings.png',
    lifetime: 60000,
    colorSpace: 'srgb-linear'
  }
]

const YavinResources: IResource[] = [
  {
    id: 114,
    actorId: 89,
    resourceType: 'diffuse',
    path: 'planets/StarWars/yavin/prime/yavin_prime.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  },
  {
    id: 115,
    actorId: 91,
    resourceType: 'diffuse',
    path: 'planets/StarWars/yavin/iv/iv.png',
    lifetime: 60000,
    colorSpace: 'srgb'
  }
]

export const Resources: IResource[] = [...TatooResources, ...YavinResources]
