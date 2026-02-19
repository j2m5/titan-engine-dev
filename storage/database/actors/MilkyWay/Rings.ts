import { IActor } from '@/core/models/types'

const SolarRings: IActor[] = [
  {
    id: 80,
    categoryId: 9,
    parentId: 38,
    name: 'Saturn',
    description: '',
    color: '#ffffff'
  },
  {
    id: 81,
    categoryId: 9,
    parentId: 39,
    name: 'Uranus',
    description: '',
    color: '#ffffff'
  },
  {
    id: 82,
    categoryId: 9,
    parentId: 40,
    name: 'Neptune',
    description: '',
    color: '#ffffff'
  }
]

export const Rings: IActor[] = [...SolarRings]
