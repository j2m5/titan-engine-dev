import { IActor } from '@/core/models/types'

const Common: IActor[] = [
  {
    id: 31,
    categoryId: 6,
    parentId: 23,
    name: 'Sun',
    description: '',
    color: '#ffff00'
  },
  {
    id: 32,
    categoryId: 7,
    parentId: 23,
    name: 'Mercury',
    description: '',
    color: '#a8a6a6'
  },
  {
    id: 33,
    categoryId: 7,
    parentId: 23,
    name: 'Venus',
    description: '',
    color: '#cd853f'
  },
  {
    id: 34,
    categoryId: 7,
    parentId: 24,
    name: 'Earth',
    description: '',
    color: '#6495ed'
  },
  {
    id: 35,
    categoryId: 7,
    parentId: 25,
    name: 'Mars',
    description: '',
    color: '#b22222'
  },
  {
    id: 36,
    categoryId: 7,
    parentId: 23,
    name: 'Ceres',
    description: '',
    color: '#939191'
  },
  {
    id: 37,
    categoryId: 7,
    parentId: 26,
    name: 'Jupiter',
    description: '',
    color: '#f17c7c'
  },
  {
    id: 38,
    categoryId: 7,
    parentId: 27,
    name: 'Saturn',
    description: '',
    color: '#cc9e26'
  },
  {
    id: 39,
    categoryId: 7,
    parentId: 28,
    name: 'Uranus',
    description: '',
    color: '#6fc5c2'
  },
  {
    id: 40,
    categoryId: 7,
    parentId: 29,
    name: 'Neptune',
    description: '',
    color: '#0f7eb9'
  },
  {
    id: 41,
    categoryId: 7,
    parentId: 30,
    name: 'Pluto',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 42,
    categoryId: 7,
    parentId: 23,
    name: 'Haumea',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 43,
    categoryId: 7,
    parentId: 23,
    name: 'Makemake',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 44,
    categoryId: 7,
    parentId: 23,
    name: 'Eris',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 45,
    categoryId: 7,
    parentId: 23,
    name: 'Sedna',
    description: '',
    color: '#c9cfd2'
  }
]
const Satellites: IActor[] = [
  {
    id: 46,
    categoryId: 7,
    parentId: 24,
    name: 'Moon',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 47,
    categoryId: 7,
    parentId: 26,
    name: 'Io',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 48,
    categoryId: 7,
    parentId: 26,
    name: 'Europa',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 49,
    categoryId: 7,
    parentId: 26,
    name: 'Ganymede',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 50,
    categoryId: 7,
    parentId: 26,
    name: 'Callisto',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 51,
    categoryId: 7,
    parentId: 27,
    name: 'Mimas',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 52,
    categoryId: 7,
    parentId: 27,
    name: 'Enceladus',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 53,
    categoryId: 7,
    parentId: 27,
    name: 'Tethys',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 54,
    categoryId: 7,
    parentId: 27,
    name: 'Dione',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 55,
    categoryId: 7,
    parentId: 27,
    name: 'Rhea',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 56,
    categoryId: 7,
    parentId: 27,
    name: 'Titan',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 57,
    categoryId: 7,
    parentId: 27,
    name: 'Iapetus',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 58,
    categoryId: 7,
    parentId: 28,
    name: 'Miranda',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 59,
    categoryId: 7,
    parentId: 28,
    name: 'Ariel',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 60,
    categoryId: 7,
    parentId: 28,
    name: 'Umbriel',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 61,
    categoryId: 7,
    parentId: 28,
    name: 'Titania',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 62,
    categoryId: 7,
    parentId: 28,
    name: 'Oberon',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 63,
    categoryId: 7,
    parentId: 29,
    name: 'Triton',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 64,
    categoryId: 7,
    parentId: 30,
    name: 'Charon',
    description: '',
    color: '#c9cfd2'
  },
  {
    id: 65,
    categoryId: 7,
    parentId: 44,
    name: 'Dysnomia',
    description: '',
    color: '#c9cfd2'
  }
]

export const SolarSystemCelestialObjects: IActor[] = [...Common, ...Satellites]
