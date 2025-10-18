import { IActor } from '@/core/models/types'

const SolarBarycenters: IActor[] = [
  {
    id: 23,
    categoryId: 4,
    parentId: 86,
    name: 'Solar system barycenter',
    description: '',
    color: '#ffff00'
  },
  {
    id: 24,
    categoryId: 4,
    parentId: 23,
    name: 'Earth system barycenter',
    description: '',
    color: '#6495ed'
  },
  {
    id: 25,
    categoryId: 4,
    parentId: 23,
    name: 'Mars system barycenter',
    description: '',
    color: '#b22222'
  },
  {
    id: 26,
    categoryId: 4,
    parentId: 23,
    name: 'Jupiter system barycenter',
    description: '',
    color: '#f17c7c'
  },
  {
    id: 27,
    categoryId: 4,
    parentId: 23,
    name: 'Saturn system barycenter',
    description: '',
    color: '#cc9e26'
  },
  {
    id: 28,
    categoryId: 4,
    parentId: 23,
    name: 'Uranus system barycenter',
    description: '',
    color: '#6fc5c2'
  },
  {
    id: 29,
    categoryId: 4,
    parentId: 23,
    name: 'Neptune system barycenter',
    description: '',
    color: '#0f7eb9'
  },
  {
    id: 30,
    categoryId: 4,
    parentId: 23,
    name: 'Pluto system barycenter',
    description: '',
    color: '#c9cfd2'
  }
]

export const Barycenters: IActor[] = [...SolarBarycenters]
